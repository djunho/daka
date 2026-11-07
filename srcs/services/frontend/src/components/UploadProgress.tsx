import { useId } from 'react'

type UploadProgressProps = {
  // What is being sent, e.g. "A enviar fotografia 2 de 3".
  label: string
  // Share of the file sent so far, from 0 to 1.
  fraction: number
}

// Progress bar for an upload (photos, avatar, documents).
//
// At 100% the bytes have left the browser, but nginx and the backend still
// have work to do (nginx receives the whole body before passing it on, the
// backend validates and re-encodes it), so the bar then says "A processar…"
// instead of looking stuck.
//
// Screen readers: the bar is a progressbar with its value, so it can be read
// at any moment, but only the start of each file and the processing step are
// announced, never every percentage.
export default function UploadProgress({ label, fraction }: UploadProgressProps) {
  const labelId = useId()
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  const processing = percent >= 100

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <p id={labelId} className="font-semibold text-ink min-w-0 truncate">{label}</p>
        <span aria-hidden="true" className="text-muted shrink-0 tabular-nums">
          {processing ? 'A processar…' : `${percent}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={processing ? 'A processar…' : `${percent}%`}
        className="h-2 rounded-full bg-paper border border-line overflow-hidden"
      >
        <div
          className="h-full bg-brand transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p role="status" className="sr-only">
        {processing ? `${label}: a processar…` : label}
      </p>
    </div>
  )
}
