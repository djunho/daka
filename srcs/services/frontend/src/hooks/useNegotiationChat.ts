import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiListNegotiationMessages } from '../lib/api'
import { getWebSocketErrorMessage } from '../lib/errors'
import type {
  IncomingWebSocketEvent,
  MessageSendEvent,
} from '../types/chat'

export type ChatConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface ChatMessageItem {
  id: number
  negotiationId: number
  senderId: number
  content: string
  createdAt: string
  isOwn: boolean
}

export interface UseNegotiationChatOptions {
  isReadOnly?: boolean
}

export interface UseNegotiationChatReturn {
  messages: ChatMessageItem[]
  status: ChatConnectionStatus
  isLoadingHistory: boolean
  isReadOnly: boolean
  error: string | null
  clearError: () => void
  sendMessage: (content: string) => boolean
}

/**
 * Hook to manage real-time WebSocket communication and initial REST history for a negotiation chat.
 * Handles:
 * 1. Initial message history fetching via GET /api/negotiations/:id/messages
 * 2. Connecting to wss://<host>/api/ws/negotiations/:id with automatic exponential backoff reconnection
 * 3. Sending message.send events and appending incoming message.created broadcasts with deduplication
 * 4. Read-only negotiation state guarding against sending messages in concluded or cancelled trades
 */
export function useNegotiationChat(
  negotiationId: number | null,
  options?: UseNegotiationChatOptions,
): UseNegotiationChatReturn {
  const { user } = useAuth()
  const currentUserId = user?.id

  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [status, setStatus] = useState<ChatConnectionStatus>('disconnected')
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false)
  const [serverReadOnly, setServerReadOnly] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef<number>(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const effectiveReadOnly = Boolean(options?.isReadOnly || serverReadOnly)

  // Clear messages and reset state when negotiationId changes
  useEffect(() => {
    setMessages([])
    setError(null)
    setServerReadOnly(false)
  }, [negotiationId])

  // Helper to fetch history via REST and merge deduplicated items
  const syncHistory = useCallback(
    async (negId: number, userId: number, isCancelled: () => boolean) => {
      try {
        const page = await apiListNegotiationMessages(negId, { limit: 50 })
        if (isCancelled()) return

        const historicalItems: ChatMessageItem[] = page.items.map((item) => ({
          id: item.id,
          negotiationId: item.negotiation_id,
          senderId: item.sender.id,
          content: item.content,
          createdAt: item.created_at,
          isOwn: item.sender.id === userId,
        }))

        setMessages((prev) => {
          // Deduplicate by database message ID
          const existingIds = new Set(historicalItems.map((m) => m.id))
          const realtimeOnly = prev.filter((m) => !existingIds.has(m.id))
          return [...historicalItems, ...realtimeOnly].sort((a, b) => a.id - b.id)
        })
      } catch (err) {
        if (!isCancelled()) {
          console.warn('Could not sync negotiation history:', err)
        }
      }
    },
    [],
  )

  // Fetch initial message history from the REST endpoint
  useEffect(() => {
    if (!negotiationId || !currentUserId) {
      setIsLoadingHistory(false)
      return
    }

    let isCancelled = false
    setIsLoadingHistory(true)

    syncHistory(negotiationId, currentUserId, () => isCancelled).finally(() => {
      if (!isCancelled) {
        setIsLoadingHistory(false)
      }
    })

    return () => {
      isCancelled = true
    }
  }, [negotiationId, currentUserId, syncHistory])

  // Establish and manage the WebSocket lifecycle for the active negotiation
  useEffect(() => {
    if (!negotiationId || !currentUserId) {
      setStatus('disconnected')
      return
    }

    let isCancelled = false
    let socket: WebSocket | null = null

    const connect = () => {
      if (isCancelled) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/ws/negotiations/${negotiationId}`

      setStatus('connecting')
      socket = new WebSocket(wsUrl)
      socketRef.current = socket

      socket.onopen = () => {
        if (isCancelled) return
        setStatus('connected')
        setError(null)

        // If this was a reconnection after a disconnect, backfill any messages missed while offline
        if (reconnectAttemptsRef.current > 0) {
          syncHistory(negotiationId, currentUserId, () => isCancelled)
        }
        reconnectAttemptsRef.current = 0
      }

      socket.onmessage = (event: MessageEvent) => {
        if (isCancelled) return
        try {
          const data = JSON.parse(event.data) as IncomingWebSocketEvent

          if (data.type === 'message.created') {
            const incoming = data.message
            setMessages((prev) => {
              // Deduplicate incoming messages by unique database ID
              if (prev.some((m) => m.id === incoming.id)) {
                return prev
              }
              const newItem: ChatMessageItem = {
                id: incoming.id,
                negotiationId: incoming.negotiation_id,
                senderId: incoming.sender_id,
                content: incoming.content,
                createdAt: incoming.created_at,
                isOwn: incoming.sender_id === currentUserId,
              }
              return [...prev, newItem]
            })
          } else if (data.type === 'error') {
            if (data.error.code === 'negotiation_read_only') {
              setServerReadOnly(true)
            }
            setError(getWebSocketErrorMessage(data.error.code, data.error.retry_after))
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message frame:', err)
        }
      }

      socket.onerror = (e) => {
        if (isCancelled) return
        console.error('WebSocket error:', e)
        setStatus('error')
      }

      socket.onclose = (event: CloseEvent) => {
        if (isCancelled) return

        // Normal closure (code 1000, e.g. unmount or switching chat): do not reconnect
        if (event.code === 1000) {
          setStatus('disconnected')
          return
        }

        // Terminal server codes: do not reconnect
        if (event.code === 4401 || event.code === 4403 || event.code === 4404) {
          setError(getWebSocketErrorMessage(event.code))
          setStatus('disconnected')
          return
        }

        // Unexpected disconnect: attempt reconnection with exponential backoff
        // Delays: 1s, 2s, 4s, 8s, 16s, max 30s
        setStatus('connecting')
        const attempt = reconnectAttemptsRef.current
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000)
        reconnectAttemptsRef.current = attempt + 1

        reconnectTimerRef.current = setTimeout(() => {
          if (!isCancelled) {
            connect()
          }
        }, delay)
      }
    }

    connect()

    return () => {
      isCancelled = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (socket) {
        socket.close(1000, 'Chat closed or switched')
      }
      socketRef.current = null
      reconnectAttemptsRef.current = 0
    }
  }, [negotiationId, currentUserId, syncHistory])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  /**
   * Submit a new text message through the active WebSocket channel.
   * Returns true if the message frame was successfully buffered for transmission.
   */
  const sendMessage = useCallback(
    (content: string): boolean => {
      if (effectiveReadOnly) {
        setError(getWebSocketErrorMessage('negotiation_read_only'))
        return false
      }

      const trimmed = content.trim()
      const length = [...trimmed].length

      if (length < 1 || length > 250) {
        return false
      }

      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        setError(getWebSocketErrorMessage('persistence_failed'))
        return false
      }

      const payload: MessageSendEvent = {
        type: 'message.send',
        content: trimmed,
      }

      socketRef.current.send(JSON.stringify(payload))
      return true
    },
    [effectiveReadOnly],
  )

  return {
    messages,
    status,
    isLoadingHistory,
    isReadOnly: effectiveReadOnly,
    error,
    clearError,
    sendMessage,
  }
}
