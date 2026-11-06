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
// transient failure worth retrying, or a refusal a retry could not fix
// (401/403/404, named after the matching WebSocket error codes).
type RefusalCode = 'unauthenticated' | 'forbidden' | 'negotiation_not_found'
type SyncResult = 'merged' | 'dropped' | 'failed' | RefusalCode

// Error frames the server sends right before closing with 4401/4403/4404
const CLOSING_ERROR_CODES = new Set(['unauthenticated', 'forbidden', 'negotiation_not_found'])

// How long a socket must stay open before the reconnect backoff resets
const STABLE_CONNECTION_MS = 5000

const REFUSAL_BY_STATUS: Partial<Record<number, RefusalCode>> = {
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'negotiation_not_found',
}

function isRefusal(result: SyncResult): result is RefusalCode {
  return result === 'unauthenticated' || result === 'forbidden' || result === 'negotiation_not_found'
}

export interface ChatMessageItem {
  id: number
  negotiationId: number
  senderId: number
  content: string
  createdAt: string
  isOwn: boolean
}

// New messages from the other person, for announcing: a live message.created
// or what a reconnect backfill brought back. Not the first load, not older
// pages, not our own messages. `seq` changes on every batch, even when the
// text repeats, so the widget can re-announce identical replies ("Ok").
export interface IncomingBatch {
  seq: number
  messages: ChatMessageItem[]
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
  // Bumped for every error shown, even an identical one, so it can be
  // announced again; errorIsNotice marks information rather than a failure
  // (stored but not broadcast, negotiation closed).
  errorSeq: number
  errorIsNotice: boolean
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
  incoming: IncomingBatch
  // The socket was refused for good (4401/4403/4404); `error` says why.
  connectionRefused: boolean
  // The last "older messages" page could not be loaded; loadOlder() retries it.
  olderFailed: boolean
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
  const { user, logout, syncUser } = useAuth()
  const currentUserId = user?.id

  // logout is recreated on every AuthProvider render; keep the latest one in a
  // ref so the socket effect below does not reconnect because of it.
  const logoutRef = useRef(logout)
  useEffect(() => {
    logoutRef.current = logout
  }, [logout])
  const syncUserRef = useRef(syncUser)
  useEffect(() => {
    syncUserRef.current = syncUser
  }, [syncUser])

  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [status, setStatus] = useState<ChatConnectionStatus>('disconnected')
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false)
  const [serverReadOnly, setServerReadOnly] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [errorSeq, setErrorSeq] = useState<number>(0)
  const [errorIsNotice, setErrorIsNotice] = useState<boolean>(false)
  const showError = useCallback((message: string, notice = false) => {
    setError(message)
    setErrorIsNotice(notice)
    setErrorSeq((seq) => seq + 1)
  }, [])
  const [hasOlder, setHasOlder] = useState<boolean>(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false)
  const [historyFailed, setHistoryFailed] = useState<boolean>(false)
  const [isSending, setIsSending] = useState<boolean>(false)
  const [connectionRefused, setConnectionRefused] = useState<boolean>(false)
  const [incoming, setIncoming] = useState<IncomingBatch>({ seq: 0, messages: [] })
  // Ids already announced, so a duplicate broadcast or a backfill that brings
  // back a message received live is not announced twice.
  const announcedIdsRef = useRef<Set<number>>(new Set())
  const [olderFailed, setOlderFailed] = useState<boolean>(false)
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
    announcedIdsRef.current = new Set()
    setIncoming({ seq: 0, messages: [] })
    newestPageCountRef.current = 0
    setMessages([])
    setError(null)
    setServerReadOnly(false)
    setHasOlder(false)
    setIsLoadingOlder(false)
    setHistoryFailed(false)
    setConnectionRefused(false)
    setOlderFailed(false)
  }, [negotiationId])

  // A history request refused with 401/403/404. An idle socket only learns
  // about a revoked session or membership on its next send or broadcast, so
  // the REST answer is reported here: sign out on 401 like the pages do,
  // otherwise explain and stop offering history that cannot load.
  const reportRefusal = useCallback((refusal: RefusalCode) => {
    if (refusal === 'unauthenticated') {
      void logoutRef.current()
      return
    }
    showError(getWebSocketErrorMessage(refusal))
    setConnectionRefused(true)
    setHasOlder(false)
  }, [showError])

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
  const announce = useCallback((items: ChatMessageItem[]) => {
    const news = items.filter((m) => !m.isOwn && !announcedIdsRef.current.has(m.id))
    if (news.length === 0) return
    news.forEach((m) => announcedIdsRef.current.add(m.id))
    setIncoming((previous) => ({ seq: previous.seq + 1, messages: news }))
  }, [])

  const syncHistory = useCallback(
    async (
      negId: number,
      userId: number,
      isCancelled: () => boolean,
      beforeId?: number,
      // Only a reconnect backfill brings news: messages newer than the thread
      announceNew = false,
    ): Promise<SyncResult> => {
      // Compare against the thread as it was when the page was requested: at a
      // reconnect nothing can have arrived on the new socket yet, and a live
      // message landing while the request is in flight must not hide a gap.
      const shown = messagesRef.current
      const shownOldest = shown[0]?.id ?? Infinity
      const shownNewest = shown[shown.length - 1]?.id ?? 0
      // News needs a baseline: without a merged newest page (first page failed
      // or still loading) the backfill is the history itself, not news.
      const hasBaseline = newestPageCountRef.current > 0

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
        if (gap) {
          threadGenerationRef.current += 1
          // A failure notice for an older page of the replaced thread no longer applies
          setOlderFailed(false)
        }

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
        if (announceNew && hasBaseline) announce(historicalItems.filter((m) => m.id > shownNewest))
        return 'merged'
      } catch (err) {
        // The WebSocket connection still proceeds; callers decide what to show
        const refusal = err instanceof ApiError ? REFUSAL_BY_STATUS[err.status] : undefined
        return refusal ?? 'failed'
      }
    },
    [announce],
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
      if (isRefusal(result)) reportRefusal(result)
    })

    return () => {
      isCancelled = true
    }
  }, [negotiationId, currentUserId, historyAttempt, syncHistory, reportRefusal])

  // Establish and manage the WebSocket lifecycle for the active negotiation
  useEffect(() => {
    if (!negotiationId || !currentUserId) {
      setStatus('disconnected')
      return
    }

    let isCancelled = false
    let socket: WebSocket | null = null
    // The server accepts a refused handshake and then closes it (4401/4403/
    // 4404), so opening proves nothing: the backoff resets only once the
    // socket has stayed open for a while.
    let stableTimer: ReturnType<typeof setTimeout> | null = null

    // Fetch the newest page while the chat is live (after a reconnect, or for a
    // message stored without delivery): announce what is new, recover from a
    // failed first page, report refusals, and offer a retry if it fails, since
    // messages may then be missing.
    const syncNewest = () => {
      void syncHistory(negotiationId, currentUserId, () => isCancelled, undefined, true).then((result) => {
        if (isCancelled) return
        // A refusal is reported by reportRefusal (and the socket), so an old
        // retry notice would only offer a retry that cannot work.
        if (result === 'merged' || isRefusal(result)) setHistoryFailed(false)
        else if (result === 'failed') setHistoryFailed(true)
        if (isRefusal(result)) reportRefusal(result)
      })
    }

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
        setConnectionRefused(false)

        // If this was a reconnection after a disconnect, backfill any messages missed
        // while offline (syncHistory replaces the thread when more than a page was missed)
        if (reconnectAttemptsRef.current > 0) {
          syncNewest()
        }
        stableTimer = setTimeout(() => {
          reconnectAttemptsRef.current = 0
        }, STABLE_CONNECTION_MS)
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
            const newItem: ChatMessageItem = {
              id: incoming.id,
              negotiationId: incoming.negotiation_id,
              senderId: incoming.sender_id,
              content: incoming.content,
              createdAt: incoming.created_at,
              isOwn: incoming.sender_id === currentUserId,
            }
            if (!messagesRef.current.some((m) => m.id === newItem.id)) announce([newItem])
            setMessages((prev) => {
              // Deduplicate incoming messages by unique database ID
              if (prev.some((m) => m.id === newItem.id)) {
                return prev
              }
              return [...prev, newItem]
            })
          } else if (data.type === 'error') {
            if (data.error.code === 'negotiation_read_only') {
              setServerReadOnly(true)
            }
            // Errors answer our own send. delivery_failed means it was stored
            // but not broadcast: confirm it (resending would duplicate it) and
            // fetch the newest page so it appears in the thread now, since the
            // socket may never reconnect to backfill it; anything else
            // rejected it.
            if (pendingContentRef.current !== null) {
              pendingContentRef.current = null
              setIsSending(false)
              if (data.error.code === 'delivery_failed') setConfirmedSends((count) => count + 1)
            }
            if (data.error.code === 'delivery_failed') {
              syncNewest()
            }
            // These codes precede a close with the matching code (4401/4403/
            // 4404); onclose decides what to show, so the 4401 check stays
            // quiet and a refusal is not announced twice.
            if (!CLOSING_ERROR_CODES.has(data.error.code)) {
              showError(
                getWebSocketErrorMessage(data.error.code, data.error.retry_after),
                data.error.code === 'delivery_failed' || data.error.code === 'negotiation_read_only',
              )
            }
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
        if (stableTimer) {
          clearTimeout(stableTimer)
          stableTimer = null
        }
        if (isCancelled) return
        // An unanswered send is unknown; the text stays in the composer
        pendingContentRef.current = null
        setIsSending(false)

        // Normal closure (RFC 6455 code 1000, e.g. unmount or switching chat): do not reconnect
        if (event.code === WS_CLOSE_CODES.NORMAL_CLOSURE) {
          setStatus('disconnected')
          return
        }

        // The session this socket registered with is no longer valid. That
        // need not be the session in the current cookie (another tab may have
        // signed in since), so never POST /auth/logout here: re-read the
        // session first and say nothing until it answers. Signed out or
        // another account: the auth state updates, the chat closes and the
        // message explains. Same account (a newer session) or no answer: try
        // again with backoff using the current cookie; a session that really
        // ended answers 401 on the next round.
        if (event.code === WS_CLOSE_CODES.UNAUTHORIZED) {
          setStatus('connecting')
          void syncUserRef.current().then((outcome) => {
            if (isCancelled) return
            if (outcome === 'signedOut' || outcome === 'changed') {
              showError(getWebSocketErrorMessage(event.code))
              setStatus('disconnected')
              setConnectionRefused(true)
              return
            }
            const attempt = reconnectAttemptsRef.current
            reconnectAttemptsRef.current = attempt + 1
            reconnectTimerRef.current = setTimeout(() => {
              if (!isCancelled) connect()
            }, Math.min(1000 * Math.pow(2, attempt), 30000))
          })
          return
        }

        // Other terminal server codes: do not reconnect
        if (event.code === WS_CLOSE_CODES.FORBIDDEN || event.code === WS_CLOSE_CODES.NOT_FOUND) {
          showError(getWebSocketErrorMessage(event.code))
          setStatus('disconnected')
          setConnectionRefused(true)
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
      if (stableTimer) clearTimeout(stableTimer)
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
  }, [negotiationId, currentUserId, syncHistory, reportRefusal, announce])

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
    setOlderFailed(false)
    const switched = () => negotiationIdRef.current !== negotiationId
    // The page belongs to the thread as shown now; drop it if that thread is replaced meanwhile
    const generation = threadGenerationRef.current
    const stale = () => switched() || threadGenerationRef.current !== generation
    const result = await syncHistory(negotiationId, currentUserId, stale, oldestId)
    if (switched()) return
    setOlderFailed(result === 'failed')
    setIsLoadingOlder(false)
    if (isRefusal(result)) reportRefusal(result)
  }, [negotiationId, currentUserId, hasOlder, isLoadingOlder, oldestId, syncHistory, reportRefusal])

  /**
   * Submit a new text message through the active WebSocket channel.
   * Returns true if the message frame was successfully buffered for transmission.
   */
  const sendMessage = useCallback(
    (content: string): boolean => {
      if (effectiveReadOnly) {
        showError(getWebSocketErrorMessage('negotiation_read_only'), true)
        return false
      }

      const trimmed = normaliseMessageContent(content)
      const length = [...trimmed].length

      if (length < 1 || length > MESSAGE_MAX_LENGTH) {
        return false
      }

      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        showError(getWebSocketErrorMessage('not_connected'))
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
    errorSeq,
    errorIsNotice,
    clearError,
    sendMessage,
    isSending,
    confirmedSends,
    historyFailed,
    retryHistory,
    incoming,
    connectionRefused,
    olderFailed,
    hasOlder,
    isLoadingOlder,
    loadOlder,
  }
}
