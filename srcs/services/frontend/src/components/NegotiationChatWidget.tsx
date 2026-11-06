import { useState, useRef, useEffect, type FormEvent } from 'react'
import OnlineBadge from './OnlineBadge'
import ChatMessageBubble from './ChatMessageBubble'
import { useNegotiationChat } from '../hooks/useNegotiationChat'

const MAX_MESSAGE_LENGTH = 250

export interface NegotiationChatWidgetProps {
  negotiationId: number
  interlocutorName: string
  // Presence of the other participant. Leave it undefined while the API exposes
  // no presence data: an always-offline dot would be misleading.
  interlocutorOnline?: boolean
  isReadOnly?: boolean
  onClose?: () => void
}

/**
 * Docked Floating Chat Widget (similar to LinkedIn / Facebook).
 * Designed to be rendered inside the bottom-right flex dock container.
 */
export default function NegotiationChatWidget({
  negotiationId,
  interlocutorName,
  interlocutorOnline,
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
    clearError,
    sendMessage,
  } = useNegotiationChat(negotiationId, { isReadOnly: initialReadOnly })

  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll to the bottom whenever a new message is added.
  // Reference: https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Measure code-point length safely for UTF-16 code units (e.g. emojis)
  const charCount = [...inputText].length
  const isOverLimit = charCount > MAX_MESSAGE_LENGTH
  const isConnected = status === 'connected'
  const trimmed = inputText.trim()
  const canSend = trimmed.length > 0 && !isOverLimit && isConnected && !isReadOnly

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault()
    if (isReadOnly) return
    if (!trimmed || [...trimmed].length > MAX_MESSAGE_LENGTH) return

    const sent = sendMessage(trimmed)
    if (sent) {
      setInputText('')
    }
  }

  return (
    <aside
      aria-label={`Chat da negociação #${negotiationId}`}
      className="w-80 bg-surface border border-line rounded-t-2xl shadow-2xl overflow-hidden transition-all duration-200"
    >
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
              onClick={onClose}
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
          {/* Scrollable message thread area */}
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label={`Mensagens da negociação #${negotiationId}`}
            className="flex-1 p-3 overflow-y-auto space-y-3 flex flex-col"
          >
            {isLoadingHistory && messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-muted text-xs select-none">
                <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin mb-2" />
                <p className="font-medium text-ink">A carregar mensagens...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-muted text-xs select-none">
                <span className="text-2xl mb-1">💬</span>
                <p className="font-medium text-ink">Sem mensagens ainda</p>
                <p className="text-[11px] mt-0.5">Inicia a conversa com {interlocutorName}!</p>
              </div>
            ) : (
              messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  content={msg.content}
                  createdAt={msg.createdAt}
                  isOwn={msg.isOwn}
                  senderName={msg.isOwn ? undefined : interlocutorName}
                />
              ))
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
                <span className="wrap-break-word">
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
              {/* Allow typing/pasting beyond 250 chars so users see the overflow in red (X/250) instead of silent truncation */}
              <input
                type="text"
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value)
                  if (error) clearError()
                }}
                placeholder={
                  isReadOnly
                    ? 'Negociação encerrada (modo de leitura)'
                    : status === 'connecting'
                      ? 'A ligar ao chat...'
                      : status === 'disconnected'
                        ? 'Chat desconectado'
                        : 'Escreve uma mensagem...'
                }
                maxLength={MAX_MESSAGE_LENGTH + 50}
                disabled={!isConnected || isReadOnly}
                className="flex-1 px-3 py-1.5 bg-paper border border-line focus:border-brand focus:outline-none rounded-xl text-xs text-ink placeholder:text-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="px-3 py-1.5 bg-brand not-disabled:hover:opacity-90 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                Enviar
              </button>
            </div>

            {/* Helper text and character counter */}
            <div className="flex justify-between items-center text-[10px] text-muted px-0.5 select-none">
              <span>
                {isReadOnly ? 'Chat em modo de leitura' : 'Pressiona Enter para enviar'}
              </span>
              {!isReadOnly && (
                <span className={isOverLimit ? 'text-accent font-semibold' : ''}>
                  {charCount}/{MAX_MESSAGE_LENGTH}
                </span>
              )}
            </div>
          </form>
        </div>
      )}
    </aside>
  )
}
