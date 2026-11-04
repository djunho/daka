import { useState } from 'react'
import OnlineBadge, { type PresenceStatus } from './OnlineBadge'
import ChatMessageBubble from './ChatMessageBubble'

export interface NegotiationChatWidgetProps {
  negotiationId: number
  interlocutorName: string
  interlocutorStatus?: PresenceStatus
  onClose?: () => void
}

/**
 * Docked Floating Chat Widget (similar to LinkedIn / Facebook).
 * Designed to be rendered inside the bottom-right flex dock container.
 */
export default function NegotiationChatWidget({
  negotiationId,
  interlocutorName,
  interlocutorStatus = 'online',
  onClose,
}: NegotiationChatWidgetProps) {
  // State to toggle widget between minimized and expanded
  const [isMinimized, setIsMinimized] = useState(false)

  // Mock messages for initial visual scaffolding (replaced by API data in step 3)
  const mockMessages = [
    {
      id: 1,
      content: 'Olá! Vi o teu anúncio e tenho muito interesse na troca. Ainda está disponível?',
      createdAt: '14:32',
      isOwn: false,
      senderName: interlocutorName,
    },
    {
      id: 2,
      content: 'Olá! Sim, ainda está disponível. Podes ver as especificações completas no anúncio.',
      createdAt: '14:35',
      isOwn: true,
    },
    {
      id: 3,
      content: 'Perfeito! Fiz uma proposta com um item que acho que vais gostar. Podemos combinar os detalhes por aqui!',
      createdAt: '14:38',
      isOwn: false,
      senderName: interlocutorName,
    },
  ]

  return (
    <aside
      aria-label={`Chat da negociação #${negotiationId}`}
      className="w-80 bg-surface border border-line rounded-t-2xl shadow-2xl overflow-hidden transition-all duration-200 select-none"
    >
      {/* Widget header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-brand text-white select-none">
        <div className="flex items-center gap-2 min-w-0">
          <OnlineBadge status={interlocutorStatus} size="md" />
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
            {mockMessages.map((msg) => (
              <ChatMessageBubble
                key={msg.id}
                content={msg.content}
                createdAt={msg.createdAt}
                isOwn={msg.isOwn}
                senderName={msg.senderName}
              />
            ))}
          </div>

          {/* Basic message input row */}
          <div className="p-2.5 bg-surface border-t border-line flex gap-2">
            <input
              type="text"
              placeholder="Escreve uma mensagem..."
              disabled
              className="flex-1 px-3 py-1.5 bg-paper border border-line rounded-xl text-xs text-ink placeholder:text-muted opacity-60 cursor-not-allowed"
            />
            <button
              type="button"
              disabled
              className="px-3 py-1.5 bg-brand text-white text-xs font-semibold rounded-xl opacity-60 cursor-not-allowed"
            >
              Enviar
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
