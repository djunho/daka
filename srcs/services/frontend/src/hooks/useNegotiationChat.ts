import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { ApiError, apiGetNegotiation, apiListNegotiationMessages } from '../lib/api'
import { isNegotiationReadOnly } from '../types/negotiation'
import { getWebSocketErrorMessage } from '../lib/errors'
import type {
  IncomingWebSocketEvent,
  MessageSendEvent,
} from '../types/chat'
import { MESSAGE_MAX_LENGTH, WS_CLOSE_CODES, normaliseMessageContent } from '../types/chat'

export type ChatConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

// Outcome of one history page: merged into the thread, dropped as stale, a
// transient failure worth retrying, or a terminal refusal (401/403/404) that
// the socket reports on its own and a retry could not fix.
type SyncResult = 'merged' | 'dropped' | 'failed' | 'terminal'

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
  // Buffers one message; false when it cannot be sent now (see the guards).
  sendMessage: (content: string) => boolean
  // A sent message awaits the server's answer (message.created or an error);
  // only one is in flight at a time.
  isSending: boolean
  // Incremented each time the server confirms our in-flight message, so the
  // composer clears only text the server actually stored.
  confirmedSends: number
  // The newest page could not be loaded (first load or a reconnect backfill);
  // retryHistory() asks for it again. Not set for 401/403/404: the socket
  // closes with the matching code and `error` reports that instead.
  historyFailed: boolean
  retryHistory: () => void
  // Older history is paged on demand: the first load brings the newest 50.
  hasOlder: boolean
  isLoadingOlder: boolean
  loadOlder: () => Promise<void>
}

/**
 * Hook to manage real-time WebSocket communication and initial REST history for a negotiation chat.
 * Handles:
 * 1. Initial message history fetching via GET /api/negotiations/:id/messages
 * 2. Connecting to wss://<host>/api/ws/negotiations/:id with automatic exponential backoff reconnection
 * 3. Sending message.send events and appending incoming message.created broadcasts with deduplication
 * 4. Read-only negotiation state guarding against sending messages in concluded or cancelled trades
 * 5. Loading older pages of history on demand through the before_id cursor
 */
export function useNegotiationChat(
  negotiationId: number | null,
  options?: UseNegotiationChatOptions,
): UseNegotiationChatReturn {
  const { user, logout } = useAuth()
  const currentUserId = user?.id

  // logout is recreated on every AuthProvider render; keep the latest one in a
  // ref so the socket effect below does not reconnect because of it.
  const logoutRef = useRef(logout)
  useEffect(() => {
    logoutRef.current = logout
  }, [logout])

  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [status, setStatus] = useState<ChatConnectionStatus>('disconnected')
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false)
  const [serverReadOnly, setServerReadOnly] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [hasOlder, setHasOlder] = useState<boolean>(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false)
  const [historyFailed, setHistoryFailed] = useState<boolean>(false)
  const [isSending, setIsSending] = useState<boolean>(false)
  const [confirmedSends, setConfirmedSends] = useState<number>(0)
  // Content of the message in flight, matched against our own message.created.
  // The protocol has no acknowledgement id, so our own other tab sending the
  // same text at the same moment is indistinguishable; one send at a time and
  // the server-equal trimming keep every other case exact.
  const pendingContentRef = useRef<string | null>(null)
  // Incremented by retryHistory() to run the first-page effect again
  const [historyAttempt, setHistoryAttempt] = useState<number>(0)

  const socketRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef<number>(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The negotiation currently shown: a page that arrives after a switch must
  // not be merged into the new thread.
  const negotiationIdRef = useRef<number | null>(negotiationId)
  // Mirror of `messages` for decisions made outside render (gap detection).
  const messagesRef = useRef<ChatMessageItem[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  // Bumped whenever the thread is replaced, so an older page that was requested
  // for the previous thread is dropped instead of merged into the new one.
  const threadGenerationRef = useRef<number>(0)
  // Counts newest pages merged (first load or reconnect backfill). An attempt
  // that fails after a newer one landed is moot; a failed backfill after a
  // merged first page is not, since the thread may have missed messages.
  const newestPageCountRef = useRef<number>(0)

  const effectiveReadOnly = Boolean(options?.isReadOnly || serverReadOnly)

  // Clear messages and reset state when negotiationId changes. The mirror is
  // cleared here too: the first page of the new negotiation is requested in
  // this same commit, before the mirror effect has seen the empty thread.
  useEffect(() => {
    negotiationIdRef.current = negotiationId
    messagesRef.current = []
    pendingContentRef.current = null
    setIsSending(false)
    newestPageCountRef.current = 0
    setMessages([])
    setError(null)
    setServerReadOnly(false)
    setHasOlder(false)
    setIsLoadingOlder(false)
    setHistoryFailed(false)
  }, [negotiationId])

  // Fetch one page of history via REST (the newest 50, or the 50 before
  // `beforeId`) and merge it, deduplicated by id. A dropped (cancelled) page
  // or a failed request changes nothing; see SyncResult.
  //
  // A newest page that does not overlap what was on screen means more than a
  // page arrived while offline: merging would leave a silent hole that paging
  // backwards (from the oldest shown id) could never fill. The page then
  // replaces the thread, keeping only live messages newer than it, and the
  // older messages can be paged back in. hasOlder follows the page whenever
  // the page reaches at least as far back as the thread does.
  const syncHistory = useCallback(
    async (
      negId: number,
      userId: number,
      isCancelled: () => boolean,
      beforeId?: number,
    ): Promise<SyncResult> => {
      // Compare against the thread as it was when the page was requested: at a
      // reconnect nothing can have arrived on the new socket yet, and a live
      // message landing while the request is in flight must not hide a gap.
      const shown = messagesRef.current
      const shownOldest = shown[0]?.id ?? Infinity
      const shownNewest = shown[shown.length - 1]?.id ?? 0

      try {
        const page = await apiListNegotiationMessages(negId, { limit: 50, before_id: beforeId })
        if (isCancelled()) return 'dropped'

        const historicalItems: ChatMessageItem[] = page.items.map((item) => ({
          id: item.id,
          negotiationId: item.negotiation_id,
          senderId: item.sender.id,
          content: item.content,
          createdAt: item.created_at,
          isOwn: item.sender.id === userId,
        }))

        const pageOldest = historicalItems[0]?.id
        const pageNewest = historicalItems[historicalItems.length - 1]?.id ?? 0
        // Ids are one global sequence, so adjacency cannot be told from a hole:
        // a page starting right after the newest shown id also replaces the
        // thread, and the message it hides is one page back.
        const gap = beforeId === undefined && page.has_more && pageOldest !== undefined && pageOldest > shownNewest
        if (gap) threadGenerationRef.current += 1

        setMessages((prev) => {
          if (gap) {
            return [...historicalItems, ...prev.filter((m) => m.id > pageNewest)]
          }
          // Deduplicate by database message ID
          const existingIds = new Set(historicalItems.map((m) => m.id))
          const realtimeOnly = prev.filter((m) => !existingIds.has(m.id))
          return [...historicalItems, ...realtimeOnly].sort((a, b) => a.id - b.id)
        })
        if (gap || pageOldest === undefined || pageOldest <= shownOldest) {
          setHasOlder(page.has_more)
        }
        if (beforeId === undefined) newestPageCountRef.current += 1
        return 'merged'
      } catch (err) {
        // The WebSocket connection still proceeds; callers decide what to show
        if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404)) {
          return 'terminal'
        }
        return 'failed'
      }
    },
    [],
  )

  // Whoever opened the chat (the dock, a page) may hold an old state: ask for
  // the current one, so a negotiation closed since then opens read-only
  // instead of failing on the first send. Failures are left to the socket,
  // which reports refusals with its close codes.
  useEffect(() => {
    if (!negotiationId || !currentUserId) return
    const controller = new AbortController()
    apiGetNegotiation(negotiationId, controller.signal)
      .then((negotiation) => {
        if (!controller.signal.aborted && isNegotiationReadOnly(negotiation.state)) setServerReadOnly(true)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [negotiationId, currentUserId])

  // Fetch initial message history from the REST endpoint
  useEffect(() => {
    if (!negotiationId || !currentUserId) {
      setIsLoadingHistory(false)
      return
    }

    let isCancelled = false
    // historyFailed is left as is while the attempt runs, so the retry notice
    // stays on screen (with its button disabled) instead of flashing away.
    setIsLoadingHistory(true)
    const newestPagesBefore = newestPageCountRef.current

    syncHistory(negotiationId, currentUserId, () => isCancelled).then((result) => {
      if (isCancelled) return
      // A newest page that landed meanwhile (reconnect backfill) makes a late failure moot
      const supersededByBackfill = newestPageCountRef.current !== newestPagesBefore
      setHistoryFailed(result === 'failed' && !supersededByBackfill)
      setIsLoadingHistory(false)
    })

    return () => {
      isCancelled = true
    }
  }, [negotiationId, currentUserId, historyAttempt, syncHistory])

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

        // If this was a reconnection after a disconnect, backfill any messages missed
        // while offline (syncHistory replaces the thread when more than a page was missed)
        if (reconnectAttemptsRef.current > 0) {
          void syncHistory(negotiationId, currentUserId, () => isCancelled).then((result) => {
            if (isCancelled) return
            // A successful backfill also recovers from a failed first page; a failed
            // one may have missed messages, which only a retry can bring back
            if (result === 'merged') setHistoryFailed(false)
            else if (result === 'failed') setHistoryFailed(true)
          })
        }
        reconnectAttemptsRef.current = 0
      }

      socket.onmessage = (event: MessageEvent) => {
        if (isCancelled) return
        try {
          const data = JSON.parse(event.data) as IncomingWebSocketEvent

          if (data.type === 'message.created') {
            const incoming = data.message
            if (
              incoming.sender_id === currentUserId &&
              pendingContentRef.current !== null &&
              incoming.content === pendingContentRef.current
            ) {
              pendingContentRef.current = null
              setIsSending(false)
              setConfirmedSends((count) => count + 1)
            }
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
            // Errors answer our own send. delivery_failed means it was stored
            // but not broadcast: confirm it (resending would duplicate it) and
            // let the next backfill show it; anything else rejected it.
            if (pendingContentRef.current !== null) {
              pendingContentRef.current = null
              setIsSending(false)
              if (data.error.code === 'delivery_failed') setConfirmedSends((count) => count + 1)
            }
            setError(getWebSocketErrorMessage(data.error.code, data.error.retry_after))
          }
        } catch {
          // Ignore invalid frames to prevent crashing the socket listener
        }
      }

      socket.onerror = () => {
        if (isCancelled) return
        setStatus('error')
      }

      socket.onclose = (event: CloseEvent) => {
        if (isCancelled) return
        // An unanswered send is unknown; the text stays in the composer
        pendingContentRef.current = null
        setIsSending(false)

        // Normal closure (RFC 6455 code 1000, e.g. unmount or switching chat): do not reconnect
        if (event.code === WS_CLOSE_CODES.NORMAL_CLOSURE) {
          setStatus('disconnected')
          return
        }

        // Session expired or revoked: clear it like the pages do on a REST 401,
        // so the header, dock and widget stop showing a signed-in state.
        if (event.code === WS_CLOSE_CODES.UNAUTHORIZED) {
          setError(getWebSocketErrorMessage(event.code))
          setStatus('disconnected')
          void logoutRef.current()
          return
        }

        // Other terminal server codes: do not reconnect
        if (event.code === WS_CLOSE_CODES.FORBIDDEN || event.code === WS_CLOSE_CODES.NOT_FOUND) {
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
        const s = socket
        // Close with RFC 6455 code 1000 (NORMAL_CLOSURE) so server and client
        // recognise this as an intentional disconnect rather than a network drop.
        if (s.readyState === WebSocket.CONNECTING) {
          s.onopen = () => {
            s.close(WS_CLOSE_CODES.NORMAL_CLOSURE, 'Chat closed or switched')
          }
        } else if (s.readyState === WebSocket.OPEN) {
          s.close(WS_CLOSE_CODES.NORMAL_CLOSURE, 'Chat closed or switched')
        }
      }
      socketRef.current = null
      reconnectAttemptsRef.current = 0
      // The cancelled socket's onclose is ignored, so free the send here
      pendingContentRef.current = null
      setIsSending(false)
    }
  }, [negotiationId, currentUserId, syncHistory])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const retryHistory = useCallback(() => {
    setHistoryAttempt((attempt) => attempt + 1)
  }, [])

  /**
   * Load the page of history before the oldest message shown. No-op while a
   * page is loading, before the first page arrived, or once there is nothing older.
   */
  const oldestId = messages[0]?.id
  const loadOlder = useCallback(async () => {
    if (!negotiationId || !currentUserId || !hasOlder || isLoadingOlder || oldestId === undefined) return

    setIsLoadingOlder(true)
    const switched = () => negotiationIdRef.current !== negotiationId
    // The page belongs to the thread as shown now; drop it if that thread is replaced meanwhile
    const generation = threadGenerationRef.current
    const stale = () => switched() || threadGenerationRef.current !== generation
    await syncHistory(negotiationId, currentUserId, stale, oldestId)
    if (switched()) return
    setIsLoadingOlder(false)
  }, [negotiationId, currentUserId, hasOlder, isLoadingOlder, oldestId, syncHistory])

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

      const trimmed = normaliseMessageContent(content)
      const length = [...trimmed].length

      if (length < 1 || length > MESSAGE_MAX_LENGTH) {
        return false
      }

      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        setError(getWebSocketErrorMessage('not_connected'))
        return false
      }

      if (pendingContentRef.current !== null) {
        return false
      }

      const payload: MessageSendEvent = {
        type: 'message.send',
        content: trimmed,
      }

      socketRef.current.send(JSON.stringify(payload))
      pendingContentRef.current = trimmed
      setIsSending(true)
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
    isSending,
    confirmedSends,
    historyFailed,
    retryHistory,
    hasOlder,
    isLoadingOlder,
    loadOlder,
  }
}
