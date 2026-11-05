import { useState, useRef, useEffect, type FormEvent } from 'react'
import OnlineBadge from './OnlineBadge'
import ChatMessageBubble from './ChatMessageBubble'
import { useNegotiationChat } from '../hooks/useNegotiationChat'

const MAX_MESSAGE_LENGTH = 250

export interface NegotiationChatWidgetProps {
  negotiationId: number
  interlocutorName: string
  interlocutorOnline?: boolean
  onClose?: () => void
}

/**
 * Docked Floating Chat Widget (similar to LinkedIn / Facebook).
 * Designed to be rendered inside the bottom-right flex dock container.
 */
export default function NegotiationChatWidget({
  negotiationId,
  interlocutorName,
  interlocutorOnline = false,
  onClose,
}: NegotiationChatWidgetProps) {
  // State to toggle widget between minimized and expanded
  const [isMinimized, setIsMinimized] = useState(false)
  const [inputText, setInputText] = useState('')

  const { messages, status, error, sendMessage } = useNegotiationChat(negotiationId)

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
  const canSend = charCount > 0 && !isOverLimit && isConnected

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = inputText.trim()
    if (!trimmed || [...trimmed].length > MAX_MESSAGE_LENGTH) return

    const sent = sendMessage(trimmed)
    if (sent) {
      setInputText('')
    }
  }

  return (
    <aside
      aria-label={`Chat da negociação #${negotiationId}`}
      className="w-80 bg-surface border border-line rounded-t-2xl shadow-2xl overflow-hidden transition-all duration-200 select-none"
    >
      {/* Widget header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-brand text-white select-none">
        <div className="flex items-center gap-2 min-w-0">
          <OnlineBadge online={interlocutorOnline} size="sm" />
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
          <div className="flex-1 p-3 overflow-y-auto space-y-3 flex flex-col">
            {messages.length === 0 ? (
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
              <div className="text-[10px] text-accent px-1 truncate select-none" title={error}>
                ⚠️ {error}
              </div>
            )}
            <div className="flex gap-2 items-center">
              {/* Allow typing/pasting beyond 250 chars so users see the overflow in red (X/250) instead of silent truncation */}
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  status === 'connecting'
                    ? 'A ligar ao chat...'
                    : status === 'disconnected'
                      ? 'Chat desconectado'
                      : 'Escreve uma mensagem...'
                }
                maxLength={MAX_MESSAGE_LENGTH + 50}
                disabled={!isConnected}
                className="flex-1 px-3 py-1.5 bg-paper border border-line focus:border-brand focus:outline-none rounded-xl text-xs text-ink placeholder:text-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                Enviar
              </button>
            </div>

            {/* Helper text and character counter */}
            <div className="flex justify-between items-center text-[10px] text-muted px-0.5 select-none">
              <span>Pressiona Enter para enviar</span>
              <span className={isOverLimit ? 'text-accent font-semibold' : ''}>
                {charCount}/{MAX_MESSAGE_LENGTH}
              </span>
            </div>
          </form>
        </div>
      )}
    </aside>
  )
}
