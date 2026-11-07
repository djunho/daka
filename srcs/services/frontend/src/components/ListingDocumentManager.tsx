import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  apiDeleteListingDocument,
  apiUploadListingDocument,
  listingDocumentUrl,
  type ApiDocument,
  type ApiListingDetail,
} from '../lib/api'
import Button, { buttonClasses } from './Button'
import ConfirmDialog from './ConfirmDialog'
import DocumentItem from './DocumentItem'
import Icon from './Icon'
import UploadProgress from './UploadProgress'
import {
  DOCUMENT_ACCEPT,
  MAX_LISTING_DOCUMENTS,
  getDocumentErrorMessage,
  validateDocument,
} from '../lib/documents'

type ListingDocumentManagerProps = {
  listing: ApiListingDetail
  // Every document endpoint answers with the whole updated listing.
  onChange: (listing: ApiListingDetail) => void
}

// The PDF documents of a listing on the edit page. Like the photos, each
// action is saved right away: the backend has one endpoint per action.
export default function ListingDocumentManager({ listing, onChange }: ListingDocumentManagerProps) {
  const { id, documents } = listing

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Confirms each action on screen and to screen readers. Cleared when the
  // next action starts, so the same message is announced again.
  const [status, setStatus] = useState('')
  const [upload, setUpload] = useState<{ label: string; fraction: number } | null>(null)

  const [toDelete, setToDelete] = useState<ApiDocument | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // A deleted document takes its buttons with it: the focus then goes to the
  // section heading (see ListingPhotoManager for why this is an effect).
  const focusHeading = useRef(false)
  useEffect(() => {
    if (!focusHeading.current) return
    focusHeading.current = false
    headingRef.current?.focus()
  })

  async function handleAdd(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    // Reset, so picking the same file again still fires onChange.
    e.target.value = ''
    if (files.length === 0) return
    setError(null)
    setStatus('')

    if (documents.length + files.length > MAX_LISTING_DOCUMENTS) {
      setError(`Podes ter no máximo ${MAX_LISTING_DOCUMENTS} documentos por anúncio.`)
      return
    }
    for (const file of files) {
      const problem = await validateDocument(file)
      if (problem) {
        setError(`${file.name}: ${problem}`)
        return
      }
    }

    // One by one. If one fails, the ones before it are already saved and stay.
    setBusy(true)
    try {
      for (let i = 0; i < files.length; i++) {
        const label = `A enviar documento ${i + 1} de ${files.length}`
        setUpload({ label, fraction: 0 })
        onChange(await apiUploadListingDocument(id, files[i], {
          onProgress: (fraction) => setUpload({ label, fraction }),
        }))
      }
      setStatus(files.length === 1 ? 'Documento adicionado.' : 'Documentos adicionados.')
    } catch (err) {
      setError(getDocumentErrorMessage(err, 'Não foi possível enviar o documento. Tenta outra vez.'))
    } finally {
      setBusy(false)
      setUpload(null)
    }
  }

  async function handleDelete() {
    if (!toDelete) return
    setDeleteError(null)
    setStatus('')
    setBusy(true)
    try {
      onChange(await apiDeleteListingDocument(id, toDelete.id))
      focusHeading.current = true
      setToDelete(null)
      setStatus('Documento apagado.')
    } catch (err) {
      setDeleteError(getDocumentErrorMessage(err, 'Não foi possível apagar o documento. Tenta outra vez.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="documents-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2
          id="documents-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-xs uppercase tracking-wider font-bold text-muted focus:outline-none"
        >
          Documentos
        </h2>
        <span className="text-[11px] text-muted">{documents.length}/{MAX_LISTING_DOCUMENTS}</span>
      </div>
      <p className="text-xs text-muted">
        Manual, fatura ou garantia do artigo, em PDF até 2 MB cada. As alterações ficam guardadas logo.
        Só quem tem sessão iniciada os pode abrir.
      </p>

      {documents.length > 0 && (
        <ul aria-labelledby="documents-heading" className="space-y-2">
          {documents.map((doc) => (
            <DocumentItem
              key={doc.id}
              name={doc.original_name}
              sizeBytes={doc.size_bytes}
              pageCount={doc.page_count}
              actions={
                <>
                  <a
                    href={listingDocumentUrl(id, doc.id)}
                    target="_blank"
                    rel="noopener"
                    className={buttonClasses({ variant: 'link', size: 'sm' })}
                  >
                    Abrir<span className="sr-only"> {doc.original_name}</span>
                  </a>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-accent"
                    disabled={busy}
                    onClick={() => {
                      setDeleteError(null)
                      setToDelete(doc)
                    }}
                  >
                    Apagar<span className="sr-only"> {doc.original_name}</span>
                  </Button>
                </>
              }
            />
          ))}
        </ul>
      )}

      {documents.length < MAX_LISTING_DOCUMENTS && (
        <label
          className={`${buttonClasses({ variant: 'secondary', size: 'sm' })} ${
            busy
              ? 'opacity-40 cursor-not-allowed'
              : 'cursor-pointer focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2'
          }`}
        >
          <Icon name="plus" size={16} />
          Adicionar PDF
          <input
            type="file"
            accept={DOCUMENT_ACCEPT}
            multiple
            disabled={busy}
            className="sr-only"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'documents-error' : undefined}
            onChange={(e) => void handleAdd(e)}
          />
        </label>
      )}

      {upload && <UploadProgress label={upload.label} fraction={upload.fraction} />}
      {error && (
        <p id="documents-error" role="alert" className="text-xs text-accent">
          {error}
        </p>
      )}
      {/* Always in the page, so screen readers announce the text put in it. */}
      <p role="status" className="text-xs font-semibold text-brand">
        {status && (
          <>
            <Icon name="check" size={14} className="inline-block align-[-2px] mr-1" />
            {status}
          </>
        )}
      </p>

      <ConfirmDialog
        open={toDelete !== null}
        title="Apagar documento"
        message={`“${toDelete?.original_name ?? ''}” é apagado de imediato.`}
        confirmLabel="Sim, apagar"
        busyLabel="A apagar…"
        busy={busy}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </section>
  )
}
