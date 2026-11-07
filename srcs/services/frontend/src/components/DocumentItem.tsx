import { type ReactNode } from 'react'
import Icon from './Icon'
import { formatFileSize, formatPageCount } from '../lib/documents'

type DocumentItemProps = {
  name: string
  sizeBytes: number
  // Unknown before the upload: the backend counts the pages.
  pageCount?: number
  // The links or buttons for this document ("Abrir", "Remover"...).
  actions?: ReactNode
}

// One PDF in a list: the document icon, its name, size and page count, and
// what can be done with it. Used when publishing, editing and viewing a listing.
export default function DocumentItem({ name, sizeBytes, pageCount, actions }: DocumentItemProps) {
  const details = [formatFileSize(sizeBytes), pageCount !== undefined ? formatPageCount(pageCount) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface border border-line rounded-xl px-3 py-2.5">
      <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-paper text-brand shrink-0">
        <Icon name="document" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        {/* break-all: a file name may be one long word with no spaces. */}
        <p className="text-sm font-semibold text-ink break-all">{name}</p>
        <p className="text-xs text-muted">PDF · {details}</p>
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </li>
  )
}
