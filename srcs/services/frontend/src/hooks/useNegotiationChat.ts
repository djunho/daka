import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiListNegotiationMessages } from '../lib/api'
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

export interface UseNegotiationChatReturn {
  messages: ChatMessageItem[]
  status: ChatConnectionStatus
  isLoadingHistory: boolean
  error: string | null
  sendMessage: (content: string) => boolean
}

/**
 * Hook to manage real-time WebSocket communication and initial REST history for a negotiation chat.
 * Handles:
 * 1. Initial message history fetching via GET /api/negotiations/:id/messages
 * 2. Connecting to wss://<host>/api/ws/negotiations/:id
 * 3. Sending message.send events and appending incoming message.created broadcasts with deduplication.
 */
export function useNegotiationChat(
  negotiationId: number | null,
): UseNegotiationChatReturn {
  const { user } = useAuth()
  const currentUserId = user?.id

  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [status, setStatus] = useState<ChatConnectionStatus>('disconnected')
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)

  // Clear messages and reset state when negotiationId changes
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [negotiationId])

  // Fetch initial message history from the REST endpoint
  useEffect(() => {
    if (!negotiationId || !currentUserId) {
      setIsLoadingHistory(false)
      return
    }

    let isCancelled = false
    setIsLoadingHistory(true)

    apiListNegotiationMessages(negotiationId, { limit: 50 })
      .then((page) => {
        if (isCancelled) return

        const historicalItems: ChatMessageItem[] = page.items.map((item) => ({
          id: item.id,
          negotiationId: item.negotiation_id,
          senderId: item.sender.id,
          content: item.content,
          createdAt: item.created_at,
          isOwn: item.sender.id === currentUserId,
        }))

        setMessages((prev) => {
          // Deduplicate by database message ID
          const existingIds = new Set(historicalItems.map((m) => m.id))
          const realtimeOnly = prev.filter((m) => !existingIds.has(m.id))
          return [...historicalItems, ...realtimeOnly].sort((a, b) => a.id - b.id)
        })
      })
      .catch((err) => {
        // If the endpoint is not yet available, keep existing messages intact without breaking WebSocket
        if (!isCancelled) {
          console.warn('Could not load negotiation history:', err)
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingHistory(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [negotiationId, currentUserId])

  // Establish and manage the WebSocket lifecycle for the active negotiation
  useEffect(() => {
    if (!negotiationId || !currentUserId) {
      setStatus('disconnected')
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/ws/negotiations/${negotiationId}`

    setStatus('connecting')
    const socket = new WebSocket(wsUrl)
    socketRef.current = socket

    socket.onopen = () => {
      setStatus('connected')
      setError(null)
    }

    socket.onmessage = (event: MessageEvent) => {
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
          setError(data.error.message || data.error.code)
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message frame:', err)
      }
    }

    socket.onerror = (e) => {
      console.error('WebSocket error:', e)
      setStatus('error')
    }

    socket.onclose = (event: CloseEvent) => {
      if (event.code === 4401) {
        setError('Sessão expirada. Por favor, inicia sessão novamente.')
      } else if (event.code === 4403) {
        setError('Acesso negado: não participas nesta negociação ou a origem não está autorizada (4403).')
      } else if (event.code === 4404) {
        setError('Negociação não encontrada (4404).')
      }
      setStatus('disconnected')
    }

    return () => {
      // Normal closure on unmount or negotiation switch
      socket.close(1000, 'Chat closed or switched')
      socketRef.current = null
    }
  }, [negotiationId, currentUserId])

  /**
   * Submit a new text message through the active WebSocket channel.
   * Returns true if the message frame was successfully buffered for transmission.
   */
  const sendMessage = useCallback((content: string): boolean => {
    const trimmed = content.trim()
    const length = [...trimmed].length

    if (length < 1 || length > 250) {
      return false
    }

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError('Não foi possível enviar a mensagem. Conexão inativa.')
      return false
    }

    const payload: MessageSendEvent = {
      type: 'message.send',
      content: trimmed,
    }

    socketRef.current.send(JSON.stringify(payload))
    return true
  }, [])

  return {
    messages,
    status,
    isLoadingHistory,
    error,
    sendMessage,
  }
}
