import { useEffect, useId, useRef } from 'react'
import Button from './Button'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  busyLabel: string
  busy: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

// Confirmation for destructive actions, built on the native <dialog>.
// showModal() gives focus trapping, Esc to close, an inert page behind it and
// focus back on the trigger when it closes, with no extra code.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busyLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()

  // The `open` prop is the source of truth; this keeps the real dialog in sync.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      // Esc fires "cancel". The browser would close the dialog on its own;
      // instead the parent decides, and nothing closes while the request runs.
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      // A second rapid Esc in Chromium can bypass preventDefault() on cancel
      // and force-close the native <dialog>. Re-open it if still busy, or sync
      // parent state if closed while idle.
      onClose={() => {
        if (!open) return
        if (busy) {
          dialogRef.current?.showModal()
        } else {
          onCancel()
        }
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md bg-surface border border-line rounded-2xl p-6 shadow-2xl space-y-4 backdrop:bg-ink/40 backdrop:backdrop-blur-xs"
    >
      <h2 id={titleId} className="text-base font-bold text-ink">
        {title}
      </h2>
      <p id={messageId} className="text-sm text-muted">
        {message}
      </p>

      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm} loading={busy}>
          {busy ? busyLabel : confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
