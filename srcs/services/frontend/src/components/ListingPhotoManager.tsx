import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  apiDeleteListingImage,
  apiSetPrimaryListingImage,
  apiUploadListingImage,
  type ApiImage,
  type ApiListingDetail,
} from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'
import { validateImage, IMAGE_ACCEPT } from '../lib/images'
import { MAX_LISTING_PHOTOS } from '../lib/listingForm'
import ConfirmDialog from './ConfirmDialog'

type ListingPhotoManagerProps = {
  listing: ApiListingDetail
  // Every photo endpoint answers with the whole updated listing.
  onChange: (listing: ApiListingDetail) => void
}

// The photos of a listing on the edit page. Unlike the text fields, each
// action is saved right away: the backend has one endpoint per action.
export default function ListingPhotoManager({ listing, onChange }: ListingPhotoManagerProps) {
  const { id, images } = listing

  // One action at a time: while a request runs, every button waits.
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Confirms each action on screen, and to screen readers: the button that
  // was clicked may no longer exist (e.g. "Tornar principal" on the new
  // primary). Cleared when the next action starts, so the same message is
  // announced again.
  const [status, setStatus] = useState<string>('')

  const [toDelete, setToDelete] = useState<ApiImage | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Set before an action removes the button that has the focus ("Tornar
  // principal" becomes the "Principal" label, a deleted photo takes its
  // buttons with it). The effect then puts the focus on the section heading,
  // so keyboard users stay here. It has to be an effect: it runs after the
  // ConfirmDialog's own effect closes the dialog, which would otherwise send
  // the focus back to the removed button, that is, nowhere.
  const focusHeading = useRef(false)
  useEffect(() => {
    if (!focusHeading.current) return
    focusHeading.current = false
    headingRef.current?.focus()
  })

  const photoError = (err: unknown, fallback: string) =>
    getPortugueseErrorMessage(err, fallback, {
      404: 'Esta fotografia ou o anúncio já não existem.',
      409: `O anúncio já tem o máximo de ${MAX_LISTING_PHOTOS} fotografias.`,
    })

  async function handleAdd(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    // Reset, so picking the same file again still fires onChange.
    e.target.value = ''
    if (files.length === 0) return
    setError(null)
    setStatus('')

    if (images.length + files.length > MAX_LISTING_PHOTOS) {
      setError(`Podes ter no máximo ${MAX_LISTING_PHOTOS} fotografias por anúncio.`)
      return
    }
    for (const file of files) {
      const err = validateImage(file)
      if (err) {
        setError(`${file.name}: ${err}`)
        return
      }
    }

    // One by one, showing each new photo as soon as it is stored. If one
    // fails, the ones before it are already saved and stay.
    try {
      for (let i = 0; i < files.length; i++) {
        setBusy(`A enviar fotografia ${i + 1} de ${files.length}…`)
        onChange(await apiUploadListingImage(id, files[i]))
      }
      setStatus(files.length === 1 ? 'Fotografia adicionada.' : 'Fotografias adicionadas.')
    } catch (err) {
      setError(photoError(err, 'Não foi possível enviar a fotografia. Tenta outra vez.'))
    } finally {
      setBusy(null)
    }
  }

  async function handleSetPrimary(image: ApiImage) {
    setError(null)
    setStatus('')
    setBusy('A alterar a fotografia principal…')
    try {
      onChange(await apiSetPrimaryListingImage(id, image.id))
      focusHeading.current = true
      setStatus('Fotografia principal alterada.')
    } catch (err) {
      setError(photoError(err, 'Não foi possível alterar a fotografia principal. Tenta outra vez.'))
    } finally {
      setBusy(null)
    }
  }

  function openDeleteDialog(image: ApiImage) {
    setDeleteError(null)
    setToDelete(image)
  }

  async function handleDelete() {
    if (!toDelete) return
    setDeleteError(null)
    setStatus('')
    setBusy('A apagar…')
    try {
      onChange(await apiDeleteListingImage(id, toDelete.id))
      focusHeading.current = true
      setToDelete(null)
      setStatus('Fotografia apagada.')
    } catch (err) {
      setDeleteError(photoError(err, 'Não foi possível apagar a fotografia. Tenta outra vez.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="photos-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2
          id="photos-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-xs uppercase tracking-wider font-bold text-muted focus:outline-none"
        >
          Fotografias do artigo
        </h2>
        <span className="text-[11px] text-muted">{images.length}/{MAX_LISTING_PHOTOS}</span>
      </div>
      <p className="text-xs text-muted">
        As alterações às fotografias ficam guardadas logo. A principal é a capa do anúncio.
        Formatos aceites: JPEG, PNG ou WebP até 2 MB cada.
      </p>

      <ul className="flex flex-wrap gap-3 items-center">
        {images.map((image, index) => (
          <li
            key={image.id}
            className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl border border-line bg-paper overflow-hidden shrink-0"
          >
            <img src={image.image_path} alt={`Foto ${index + 1}`} className="w-full h-full object-cover" />

            {/* Font classes on the wrappers: index.css has `button { font: inherit }`
                outside any @layer, which beats text and font utilities on the
                buttons themselves. */}
            <div className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold">
              {image.is_primary ? (
                <span className="bg-ink/80 text-surface px-2 py-0.5 rounded-md backdrop-blur-xs">
                  Principal
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSetPrimary(image)}
                  disabled={busy !== null}
                  aria-label={`Tornar a foto ${index + 1} principal`}
                  className="bg-surface/90 text-ink px-2 py-0.5 rounded-md border border-line/40 shadow-sm enabled:hover:bg-surface disabled:opacity-40"
                >
                  Tornar principal
                </button>
              )}
            </div>

            <div className="absolute top-1.5 right-1.5 text-xs">
              <button
                type="button"
                onClick={() => openDeleteDialog(image)}
                disabled={busy !== null}
                aria-label={`Apagar foto ${index + 1}`}
                className="w-6 h-6 rounded-full bg-surface/90 text-accent border border-line/40 flex items-center justify-center shadow-sm enabled:hover:bg-surface disabled:opacity-40"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          </li>
        ))}

        {images.length < MAX_LISTING_PHOTOS && (
          <li>
            <label
              className={`w-24 h-24 sm:w-28 sm:h-28 rounded-xl border-2 border-dashed border-line bg-paper/50 flex flex-col items-center justify-center transition-colors text-muted ${
                busy
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:border-brand hover:bg-paper hover:text-brand focus-within:border-brand focus-within:text-brand focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 cursor-pointer'
              }`}
            >
              <span className="text-2xl leading-none font-light" aria-hidden="true">+</span>
              <span className="text-[11px] font-medium mt-1">Adicionar</span>
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                disabled={busy !== null}
                className="sr-only"
                aria-label="Adicionar fotografias"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'photos-error' : undefined}
                onChange={handleAdd}
              />
            </label>
          </li>
        )}
      </ul>

      {busy && !toDelete && <p className="text-xs text-muted">{busy}</p>}
      {error && (
        <p id="photos-error" role="alert" className="text-xs text-accent">
          {error}
        </p>
      )}
      {/* Always in the page, so screen readers announce the text put in it. */}
      <p role="status" className="text-xs font-semibold text-brand">
        {status && (
          <>
            <span aria-hidden="true">✓ </span>
            {status}
          </>
        )}
      </p>

      <ConfirmDialog
        open={toDelete !== null}
        title="Apagar fotografia"
        message={
          toDelete?.is_primary && images.length > 1
            ? 'Esta é a fotografia principal: a mais antiga das restantes passa a ser a capa. A fotografia é apagada de imediato.'
            : 'A fotografia é apagada de imediato.'
        }
        confirmLabel="Sim, apagar"
        busyLabel="A apagar…"
        busy={busy !== null}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </section>
  )
}
