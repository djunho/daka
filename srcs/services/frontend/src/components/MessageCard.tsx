import type { ReactNode } from 'react'

type MessageCardProps = {
  // Pages that cannot show their content ("not found", "no access") have a
  // title; a loading failure only has the error text.
  title?: string
  text: ReactNode
  // An error is announced as soon as it appears.
  alert?: boolean
  // What the user can do next: a link back or "Tentar outra vez".
  action: ReactNode
}

// Replaces a whole page when it has nothing else to show.
export default function MessageCard({ title, text, alert = false, action }: MessageCardProps) {
  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-surface border border-line rounded-2xl p-8 text-center shadow-sm">
        {title && <h1 className="font-display text-2xl font-bold text-ink mb-2">{title}</h1>}
        <p role={alert ? 'alert' : undefined} className="text-sm text-muted mb-6">{text}</p>
        {action}
      </div>
    </main>
  )
}
