import { useState } from 'react'
import OnlineBadge, { type PresenceStatus } from './OnlineBadge'

export interface NegotiationChatWidgetProps {
  negotiationId: number
  interlocutorName: string
  interlocutorStatus?: PresenceStatus
  onClose?: () => void
}

/**
 * Docked Floating Chat Widget (similar to LinkedIn / Facebook).
 * Positioned fixed at the bottom-right of the viewport.
 * Designed so multiple instances can be rendered side-by-side if needed in the future.
 */
export default function NegotiationChatWidget({
  negotiationId,
  interlocutorName,
  interlocutorStatus = 'online',
  onClose,
}: NegotiationChatWidgetProps) {
  // State to toggle widget between minimized and expanded
  const [isMinimized, setIsMinimized] = useState(false)

  return (
    <aside
      aria-label={`Chat da negociação #${negotiationId}`}
      className="fixed bottom-0 right-6 z-50 w-80 bg-surface border border-line rounded-t-2xl shadow-2xl overflow-hidden transition-all duration-200"
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
          {/* Message history area (empty for now) */}
          <div className="flex-1 p-4 flex flex-col items-center justify-center text-center text-muted">
            <span className="text-2xl mb-1" aria-hidden="true">💬</span>
            <p className="text-xs font-medium text-ink">Área de mensagens</p>
            <p className="text-[11px] text-muted max-w-[200px] mt-0.5">
              As mensagens em tempo real vão aparecer aqui.
            </p>
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
