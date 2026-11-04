/**
 * Helper to format timestamp into PT-PT local time (HH:mm).
 * Supports both pre-formatted time strings ("14:32") and ISO-8601 timestamps.
 */
function formatMessageTime(value: string): string {
  if (/^\d{1,2}:\d{2}$/.test(value)) {
    return value
  }
  const date = new Date(value)
  if (isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export interface ChatMessageBubbleProps {
  content: string
  createdAt: string
  isOwn: boolean
  senderName?: string
}

/**
 * ChatMessageBubble:
 * Renders an individual chat message bubble in the conversation thread.
 * - Outgoing messages (sent by logged-in user) are aligned to the right with brand coloring.
 * - Incoming messages (received from interlocutor) are aligned to the left with neutral surface coloring.
 */
export default function ChatMessageBubble({
  content,
  createdAt,
  isOwn,
  senderName,
}: ChatMessageBubbleProps) {
  const formattedTime = formatMessageTime(createdAt)

  if (isOwn) {
    return (
      <div className="flex flex-col items-end self-end max-w-[85%]">
        <div className="bg-brand text-white rounded-2xl rounded-tr-xs px-3 py-2 shadow-xs text-xs wrap-break-word">
          {content}
        </div>
        <span className="text-[9px] text-muted mt-0.5 mr-1 select-none">
          {formattedTime}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start max-w-[85%]">
      {senderName && (
        <span className="text-[10px] font-semibold text-muted mb-0.5 ml-1 select-none">
          {senderName}
        </span>
      )}
      <div className="bg-surface border border-line text-ink rounded-2xl rounded-tl-xs px-3 py-2 shadow-xs text-xs wrap-break-word">
        {content}
      </div>
      <span className="text-[9px] text-muted mt-0.5 ml-1 select-none">
        {formattedTime}
      </span>
    </div>
  )
}
