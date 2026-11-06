import { Fragment, useState, useRef, useEffect, useLayoutEffect, type FormEvent } from 'react'
import OnlineBadge from './OnlineBadge'
import ChatMessageBubble from './ChatMessageBubble'
import { useNegotiationChat } from '../hooks/useNegotiationChat'
import { useUserPresence } from '../hooks/useUserPresence'
import { formatDate } from '../types/negotiation'
import { DOCK_TRIGGER_ID, MESSAGE_MAX_LENGTH, normaliseMessageContent } from '../types/chat'

// Calendar day in the viewer's timezone: a separator goes where it changes.
function dayKey(iso: string): string {
  const date = new Date(iso)
  return isNaN(date.getTime()) ? iso : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export interface NegotiationChatWidgetProps {
  negotiationId: number
  interlocutorId: number
  interlocutorName: string
  isReadOnly?: boolean
  onClose?: () => void
}

/**
 * Docked Floating Chat Widget (similar to LinkedIn / Facebook).
 * Designed to be rendered inside the bottom-right flex dock container.
 */
export default function NegotiationChatWidget({
  negotiationId,
  interlocutorId,
  interlocutorName,
  isReadOnly: initialReadOnly = false,
  onClose,
}: NegotiationChatWidgetProps) {
  // State to toggle widget between minimized and expanded
  const [isMinimized, setIsMinimized] = useState(false)
  const [inputText, setInputText] = useState('')

  const {
    messages,
    status,
    isLoadingHistory,
    isReadOnly,
    error,
    errorSeq,
    errorIsNotice,
    clearError,
    sendMessage,
    isSending,
    confirmedSends,
    incoming,
    historyFailed,
    retryHistory,
    connectionRefused,
    olderFailed,
    hasOlder,
    isLoadingOlder,
    loadOlder,
  } = useNegotiationChat(negotiationId, { isReadOnly: initialReadOnly })

  // Polled while the widget is open; undefined until known, so no wrong dot is shown.
  const interlocutorOnline = useUserPresence(interlocutorId)

  const logRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll to the bottom when a newer message appears (first history load,
  // a live message) and when the body is expanded again. Prepending older
  // messages leaves the newest id unchanged, so it does not scroll.
  // Reference: https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView
  const newestId = messages[messages.length - 1]?.id
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [newestId, isMinimized])

  // Screen readers hear only new messages from the other person (the hook
  // decides what is new). The thread itself is not a live region: the first
  // page, older pages and a thread replaced after a reconnect insert dozens
  // of bubbles at once, which would all be read aloud.
  const latestIncoming = incoming.messages[incoming.messages.length - 1]
  const announcement = !latestIncoming
    ? ''
    : incoming.messages.length === 1
      ? `Nova mensagem de ${interlocutorName}: ${latestIncoming.content}`
      : `${incoming.messages.length} novas mensagens de ${interlocutorName}. A última: ${latestIncoming.content}`

  // Keep the viewport on the same message when an older page is inserted above:
  // snapshot the scroll metrics on click and compensate once an older first id
  // appears. A thread replaced after a reconnect changes the first id upwards;
  // that is not a prepend, so the snapshot is discarded instead.
  const prependRef = useRef<{ firstId: number; scrollHeight: number; scrollTop: number } | null>(null)
  useLayoutEffect(() => {
    const el = logRef.current
    const snap = prependRef.current
    const firstId = messages[0]?.id
    if (!el || !snap || firstId === snap.firstId) return
    if (firstId !== undefined && firstId < snap.firstId) {
      el.scrollTop = el.scrollHeight - snap.scrollHeight + snap.scrollTop
    }
    prependRef.current = null
  }, [messages])

  const handleLoadOlder = () => {
    if (isLoadingOlder) return
    const el = logRef.current
    const firstId = messages[0]?.id
    if (el && firstId !== undefined) {
      prependRef.current = { firstId, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop }
    }
    void loadOlder()
  }

  // Code points after trimming, exactly as the backend counts (an emoji is 1)
  const trimmed = normaliseMessageContent(inputText)
  const charCount = [...trimmed].length
  const isOverLimit = charCount > MESSAGE_MAX_LENGTH
  const isConnected = status === 'connected'
  const canSend = trimmed.length > 0 && !isOverLimit && isConnected && !isReadOnly && !isSending

  // The composer keeps the text until the server stores it: a rejection
  // (rate limit, read-only, persistence failure) leaves it there to retry.
  // Text edited meanwhile is the person's new draft and is kept too.
  const sentTextRef = useRef<string | null>(null)
  useEffect(() => {
    if (confirmedSends === 0 || sentTextRef.current === null) return
    const sent = sentTextRef.current
    sentTextRef.current = null
    setInputText((current) => (normaliseMessageContent(current) === sent ? '' : current))
  }, [confirmedSends])
  const placeholder = isReadOnly
    ? 'Negociação encerrada (modo de leitura)'
    : status === 'connecting'
      ? 'A ligar ao chat...'
      : status === 'connected'
        ? 'Escreve uma mensagem...'
        : 'Chat desligado'

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    if (!trimmed || [...trimmed].length > MESSAGE_MAX_LENGTH) return

    if (sendMessage(trimmed)) {
      sentTextRef.current = trimmed
    }
  }

  // The widget opens on a person's action (a "Chat" card, "Conversar"), so it
  // takes the focus; closing it gives the focus back to what opened it, or to
  // the dock trigger when that is gone (the card of a collapsed drawer).
  const rootRef = useRef<HTMLElement | null>(null)
  const openerRef = useRef<Element | null>(null)
  useEffect(() => {
    // StrictMode runs this twice; the second run must not record the widget
    // itself (focused by the first run) as the opener.
    const active = document.activeElement
    if (openerRef.current === null && !rootRef.current?.contains(active)) openerRef.current = active
    rootRef.current?.focus()
  }, [])
  const handleClose = () => {
    const opener = openerRef.current
    const target =
      opener instanceof HTMLElement && opener.isConnected && opener !== document.body
        ? opener
        : document.getElementById(DOCK_TRIGGER_ID)
    onClose?.()
    target?.focus()
  }

  return (
    <aside
      ref={rootRef}
      tabIndex={-1}
      aria-label={`Chat da negociação #${negotiationId}`}
      className="w-[min(20rem,calc(100vw-1rem))] bg-surface border border-line rounded-t-2xl shadow-2xl overflow-hidden transition-all duration-200 focus:outline-none"
    >
      {/* Always mounted (also while minimized), so changes are announced. The
          key replaces the node per batch, so a repeated text is read again. */}
      <div aria-live="polite" className="sr-only">
        {announcement && <p key={incoming.seq}>{announcement}</p>}
      </div>
      {/* Why a send failed or the chat stopped is announced assertively;
          information (stored but not broadcast, negotiation closed) politely.
          Both regions are always mounted, and each error is a new node, so
          the same error twice is read twice. The visible banner below is
          hidden from assistive technology to avoid reading it twice. */}
      <div role="alert" className="sr-only">
        {error && !errorIsNotice && <p key={errorSeq}>{error}</p>}
      </div>
      <div aria-live="polite" className="sr-only">
        {error && errorIsNotice && <p key={errorSeq}>{error}</p>}
      </div>
      {/* Widget header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-brand text-white select-none">
        <div className="flex items-center gap-2 min-w-0">
          {interlocutorOnline !== undefined && (
            <OnlineBadge online={interlocutorOnline} size="sm" />
          )}
          <h3 className="font-semibold text-sm truncate">
            {interlocutorName}
          </h3>
          <span className="text-[10px] text-white/70 shrink-0">
            #{negotiationId}
          </span>
        </div>

        {/* Action buttons: Minimize and Close */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            aria-label={isMinimized ? 'Expandir chat' : 'Minimizar chat'}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/20 text-white text-xs font-bold transition-colors"
          >
            {isMinimized ? '▲' : '—'}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={handleClose}
              aria-label="Fechar chat"
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/20 text-white text-xs font-bold transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Chat body (visible only when not minimized) */}
      {!isMinimized && (
        <div className="flex flex-col h-80 bg-paper">
          {/* History failure notice: outside the live log region (it holds a
              control and must not be announced as a log addition). The status
              region is always mounted, empty when all is well, because a live
              region inserted together with its text is often not announced. */}
          <div
            role="status"
            className={
              historyFailed || olderFailed
                ? 'm-3 mb-0 flex flex-col items-center gap-1 text-center text-[11px] text-accent bg-accent/10 rounded-lg px-3 py-2'
                : 'sr-only'
            }
          >
            {/* The older-messages button in the thread stays the way to retry */}
            {olderFailed && !historyFailed && (
              <span>Não foi possível carregar as mensagens anteriores. Tenta novamente.</span>
            )}
            {historyFailed && (
              <>
                <span>Não foi possível carregar as mensagens.</span>
                {/* aria-disabled while it runs, not disabled: a disabled control
                    drops the keyboard focus to <body> */}
                <button
                  type="button"
                  onClick={() => {
                    if (!isLoadingHistory) retryHistory()
                  }}
                  aria-disabled={isLoadingHistory || undefined}
                  className="font-semibold underline not-aria-disabled:hover:opacity-80 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                >
                  Tentar novamente
                </button>
              </>
            )}
          </div>

          {/* Scrollable message thread area */}
          <div
            ref={logRef}
            role="log"
            aria-live="off"
            aria-label={`Mensagens da negociação #${negotiationId}`}
            className="flex-1 p-3 overflow-y-auto space-y-3 flex flex-col"
          >
            {isLoadingHistory && messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-muted text-xs select-none">
                <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin mb-2" />
                <p className="font-medium text-ink">A carregar mensagens...</p>
              </div>
            ) : messages.length === 0 ? (
              // No invitation to start the conversation when the history failed
              // or the socket was refused (the notice or the error banner explain)
              historyFailed || connectionRefused ? null : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-muted text-xs select-none">
                  <span className="text-2xl mb-1">💬</span>
                  {isReadOnly ? (
                    // Nothing can be sent any more: no invitation to start
                    <p className="font-medium text-ink">Sem mensagens nesta negociação</p>
                  ) : (
                    <>
                      <p className="font-medium text-ink">Sem mensagens ainda</p>
                      <p className="text-[11px] mt-0.5">Inicia a conversa com {interlocutorName}!</p>
                    </>
                  )}
                </div>
              )
            ) : (
              <>
                {hasOlder && (
                  <div className="self-center flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      onClick={handleLoadOlder}
                      // aria-disabled while the page loads, so the focus stays here
                      aria-disabled={isLoadingOlder || undefined}
                      className="text-[11px] font-medium text-brand not-aria-disabled:hover:underline aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                    >
                      {isLoadingOlder ? 'A carregar…' : 'Ver mensagens anteriores'}
                    </button>
                  </div>
                )}
                {messages.map((msg, index) => {
                  const previous = messages[index - 1]
                  const startsDay = !previous || dayKey(previous.createdAt) !== dayKey(msg.createdAt)
                  return (
                    <Fragment key={msg.id}>
                      {startsDay && (
                        <div className="self-center text-[10px] font-medium text-muted bg-surface border border-line rounded-full px-2 py-0.5 select-none">
                          {formatDate(msg.createdAt)}
                        </div>
                      )}
                      <ChatMessageBubble
                        content={msg.content}
                        createdAt={msg.createdAt}
                        isOwn={msg.isOwn}
                        senderName={msg.isOwn ? undefined : interlocutorName}
                      />
                    </Fragment>
                  )
                })}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Interactive message input form */}
          <form
            onSubmit={handleSendMessage}
            className="p-2.5 bg-surface border-t border-line flex flex-col gap-1.5"
          >
            {error && (
              <div className="flex items-start justify-between gap-2 text-[11px] text-accent bg-accent/10 px-2.5 py-1.5 rounded-lg select-none leading-tight">
                {/* For more info about this word break: https://tailwindcss.com/docs/overflow-wrap */}
                <span className="wrap-break-word" aria-hidden="true">
                  ⚠️ {error}
                </span>
                <button
                  type="button"
                  onClick={clearError}
                  aria-label="Dispensar aviso de erro"
                  className="text-accent hover:opacity-80 font-bold px-1 rounded transition-colors shrink-0 -mr-0.5"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex gap-2 items-center">
              {/* No maxLength on purpose: the browser counts UTF-16 units (an emoji is 2)
                  and truncates pastes silently. The counter below turns red past the
                  code-point limit, the send button is aria-disabled, and the canSend
                  check in handleSendMessage is the real guard. */}
              <input
                type="text"
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value)
                  if (error) clearError()
                }}
                placeholder={placeholder}
                aria-label="Mensagem"
                // Only a closed negotiation disables the composer. While the
                // chat reconnects it is read-only instead, so a focused input
                // keeps the keyboard focus (a disabled one drops it to <body>).
                disabled={isReadOnly}
                readOnly={!isConnected}
                aria-disabled={!isConnected || undefined}
                className="flex-1 px-3 py-1.5 bg-paper border border-line focus:border-brand focus:outline-none rounded-xl text-xs text-ink placeholder:text-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
              />
              {/* Likewise the button is aria-disabled, not disabled, whenever it
                  cannot send (empty, over the limit, reconnecting, in flight,
                  just confirmed), so pressing it never loses the focus; only a
                  closed negotiation disables it. */}
              <button
                type="submit"
                disabled={isReadOnly}
                aria-disabled={!canSend || undefined}
                className="px-3 py-1.5 bg-brand not-disabled:not-aria-disabled:hover:opacity-90 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed shrink-0"
              >
                {isSending ? 'A enviar…' : 'Enviar'}
              </button>
            </div>

            {/* Helper text and character counter */}
            <div className="flex justify-between items-center text-[10px] text-muted px-0.5 select-none">
              <span>
                {isReadOnly ? 'Chat em modo de leitura' : 'Carrega em Enter para enviar'}
              </span>
              {!isReadOnly && (
                <span className={isOverLimit ? 'text-accent font-semibold' : ''}>
                  {charCount}/{MESSAGE_MAX_LENGTH}
                </span>
              )}
            </div>
          </form>
        </div>
      )}
    </aside>
  )
}
