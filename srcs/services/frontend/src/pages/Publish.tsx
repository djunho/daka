import { useState, useEffect, useCallback, useRef, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  apiListCategories,
  apiListConditions,
  apiCreateListing,
  apiUpdateListing,
  apiUploadListingImage,
  type ApiCategory,
  type ApiCondition,
} from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'
import ListingFields from '../components/ListingFields'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { validateImage, IMAGE_ACCEPT } from '../lib/images'
import {
  EMPTY_LISTING_FORM,
  focusFirstError,
  toListingPayload,
  validateListingForm,
  type ListingFormErrors,
  type ListingFormValues,
} from '../lib/listingForm'

// Maximum number of photos per listing, mirroring backend MAX_IMAGES_PER_LISTING.
const MAX_PHOTOS = 6

interface PhotoThumbnailProps {
  file: File
  index: number
  disabled?: boolean
  onRemove: (index: number) => void
}

function PhotoThumbnail({ file, index, disabled = false, onRemove }: PhotoThumbnailProps) {
  const previewUrl = useObjectUrl(file)

  return (
    <div className="relative group w-24 h-24 sm:w-28 sm:h-28 rounded-xl border border-line bg-paper overflow-hidden flex items-center justify-center shrink-0">
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={`Foto ${index + 1}`}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-paper animate-pulse" />
      )}

      {/* Primary photo badge (cover image) */}
      {index === 0 && (
        <span className="absolute bottom-1.5 left-1.5 bg-ink/80 text-surface text-[10px] font-semibold px-2 py-0.5 rounded-md backdrop-blur-xs">
          Principal
        </span>
      )}

      {/* Photo removal button */}
      {!disabled && (
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label={`Remover foto ${index + 1}`}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-surface/90 text-accent hover:bg-surface border border-line/40 flex items-center justify-center text-xs shadow-sm transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          ✕
        </button>
      )}
    </div>
  )
}

export default function Publish() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [conditions, setConditions] = useState<ApiCondition[]>([])
  const [isLoadingMeta, setIsLoadingMeta] = useState(true)
  const [metaError, setMetaError] = useState<string | null>(null)

  // Form input fields state
  const [values, setValues] = useState<ListingFormValues>(EMPTY_LISTING_FORM)
  const [errors, setErrors] = useState<ListingFormErrors>({})

  // Photo selection state
  const [photos, setPhotos] = useState<File[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)

  // Form submission lifecycle state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittingStatus, setSubmittingStatus] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Track created listing ID and uploaded photos count to prevent duplicate listings on retry
  const createdListingIdRef = useRef<number | null>(null)
  const uploadedPhotosCountRef = useRef(0)

  const loadMetadata = useCallback(async () => {
    setIsLoadingMeta(true)
    setMetaError(null)
    try {
      const [cats, conds] = await Promise.all([
        apiListCategories(),
        apiListConditions(),
      ])
      setCategories(cats)
      setConditions(conds)
    } catch (err) {
      setMetaError(
        getPortugueseErrorMessage(
          err,
          'Não foi possível carregar as opções de publicação. Por favor, tenta novamente.',
        ),
      )
    } finally {
      setIsLoadingMeta(false)
    }
  }, [])

  useEffect(() => {
    loadMetadata()
  }, [loadMetadata])

  const handlePhotoSelect = (e: ChangeEvent<HTMLInputElement>) => {
    setPhotoError(null)
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return

    if (photos.length + files.length > MAX_PHOTOS) {
      setPhotoError(`Podes adicionar no máximo ${MAX_PHOTOS} fotografias por anúncio.`)
      return
    }

    const existingKeys = new Set(photos.map((p) => `${p.name}-${p.size}-${p.lastModified}`))
    for (const f of files) {
      const key = `${f.name}-${f.size}-${f.lastModified}`
      if (existingKeys.has(key)) {
        setPhotoError(`A fotografia "${f.name}" já foi adicionada.`)
        return
      }
      existingKeys.add(key)

      const err = validateImage(f)
      if (err) {
        setPhotoError(`${f.name}: ${err}`)
        return
      }
    }

    setPhotos((prev) => [...prev, ...files])
  }

  const handleRemovePhoto = (indexToRemove: number) => {
    // Prevent removal of photos that were already successfully uploaded to the backend
    if (indexToRemove < uploadedPhotosCountRef.current) {
      return
    }
    setPhotos((prev) => prev.filter((_, i) => i !== indexToRemove))
    setPhotoError(null)
  }

  // Saves the fields that changed and clears their error messages.
  const handleFieldChange = (changes: Partial<ListingFormValues>) => {
    setValues((prev) => ({ ...prev, ...changes }))
    setErrors((prev) => {
      const next = { ...prev }
      for (const name of Object.keys(changes) as Array<keyof ListingFormValues>) {
        delete next[name]
      }
      return next
    })
  }

  // Client-side validation mirroring backend ListingCreateIn schema
  const validate = (): boolean => {
    const newErrors = validateListingForm(values)
    setErrors(newErrors)
    return !focusFirstError(newErrors)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    if (!validate()) {
      return
    }

    setIsSubmitting(true)
    setSubmittingStatus('A publicar anúncio…')

    try {
      const payload = toListingPayload(values)

      // Create listing record first or resume if already created on prior partial failure
      let listingId = createdListingIdRef.current
      if (listingId === null) {
        const newListing = await apiCreateListing(payload)
        listingId = newListing.id
        createdListingIdRef.current = listingId
      } else {
        // If the listing was already created on a previous attempt, sync any edits
        // made by the user before resuming photo uploads.
        await apiUpdateListing(listingId, payload)
      }

      // Sequentially upload remaining photos to POST /api/listings/{id}/images
      for (let i = uploadedPhotosCountRef.current; i < photos.length; i++) {
        setSubmittingStatus(`A enviar fotografia ${i + 1} de ${photos.length}…`)
        await apiUploadListingImage(listingId, photos[i])
        uploadedPhotosCountRef.current = i + 1
      }

      // Redirect user to the newly created listing page
      navigate(`/listing/${listingId}`)
    } catch (err) {
      setSubmitError(
        getPortugueseErrorMessage(
          err,
          'Não foi possível publicar o anúncio. Por favor, tenta novamente.',
          {
            404: 'O anúncio não foi encontrado.',
            409: `O anúncio já atingiu o limite máximo de ${MAX_PHOTOS} fotografias.`,
          },
        ),
      )
    } finally {
      setIsSubmitting(false)
      setSubmittingStatus(null)
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-surface border border-line rounded-2xl p-6 sm:p-8 shadow-sm">
        {/* Header */}
        <div className="border-b border-line pb-4 mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Publicar anúncio</h1>
          <p className="text-sm text-muted mt-1">
            Regista um artigo que já não usas e encontra o que procuras em troca.
          </p>
        </div>

        {/* Metadata loading state */}
        {isLoadingMeta && (
          <div className="py-12 text-center">
            <div className="inline-block w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-muted">A carregar opções de publicação…</p>
          </div>
        )}

        {/* Metadata error state */}
        {!isLoadingMeta && metaError && (
          <div className="bg-accent/10 border border-accent/20 rounded-xl p-4 text-center my-4">
            <p className="text-sm text-accent mb-3">{metaError}</p>
            <button
              type="button"
              onClick={loadMetadata}
              className="px-4 py-2 text-xs font-semibold bg-brand text-surface rounded-full hover:opacity-95 transition-opacity"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Listing creation form */}
        {!isLoadingMeta && !metaError && (
          <form
            onSubmit={handleSubmit}
            className="space-y-6"
            noValidate
          >
            {/* Submission error alert */}
            {submitError && (
              <div
                className="bg-accent/10 border border-accent/20 rounded-xl p-4 text-accent text-sm flex items-center justify-between gap-3"
                role="alert"
              >
                <span>{submitError}</span>
                <button
                  type="button"
                  onClick={() => setSubmitError(null)}
                  className="text-accent hover:text-ink text-xs font-bold p-1 transition-colors"
                  aria-label="Fechar alerta"
                >
                  ✕
                </button>
              </div>
            )}

            <ListingFields
              values={values}
              errors={errors}
              categories={categories}
              conditions={conditions}
              disabled={isSubmitting}
              onChange={handleFieldChange}
            />

            {/* Photos */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs uppercase tracking-wider font-bold text-muted">
                  Fotografias do artigo <span className="text-muted font-normal lowercase">(opcional)</span>
                </label>
                <span className="text-[11px] text-muted">{photos.length}/{MAX_PHOTOS}</span>
              </div>
              <p className="text-xs text-muted mb-3">
                A primeira foto será a capa do anúncio. Formatos aceites: JPEG, PNG ou WebP até 2 MB cada.
              </p>

              <div className="flex flex-wrap gap-3 items-center">
                {photos.map((file, index) => (
                  <PhotoThumbnail
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    file={file}
                    index={index}
                    disabled={isSubmitting || index < uploadedPhotosCountRef.current}
                    onRemove={handleRemovePhoto}
                  />
                ))}

                {photos.length < MAX_PHOTOS && (
                  <label
                    className={`w-24 h-24 sm:w-28 sm:h-28 rounded-xl border-2 border-dashed border-line bg-paper/50 flex flex-col items-center justify-center transition-colors text-muted shrink-0 ${
                      isSubmitting
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
                      disabled={isSubmitting}
                      className="sr-only"
                      aria-label="Adicionar fotografias"
                      aria-invalid={Boolean(photoError)}
                      aria-describedby={photoError ? 'photo-error' : undefined}
                      onChange={handlePhotoSelect}
                    />
                  </label>
                )}
              </div>

              {photoError && (
                <p id="photo-error" className="text-xs text-accent mt-2">
                  {photoError}
                </p>
              )}
            </div>

            {/* Form footer actions */}
            <div className="pt-6 border-t border-line flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
              <Link
                to="/"
                tabIndex={isSubmitting ? -1 : 0}
                aria-disabled={isSubmitting}
                onClick={(e) => {
                  if (isSubmitting) e.preventDefault()
                }}
                className={`w-full sm:w-auto px-5 py-2.5 rounded-full text-sm font-semibold text-muted hover:text-ink text-center transition-colors ${
                  isSubmitting ? 'pointer-events-none opacity-40 cursor-not-allowed' : ''
                }`}
              >
                Cancelar
              </Link>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto px-6 py-2.5 rounded-full font-semibold text-sm bg-brand text-surface hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all inline-flex items-center justify-center gap-2"
              >
                {isSubmitting && (
                  <span
                    aria-hidden="true"
                    className="inline-block w-4 h-4 border-2 border-surface border-t-transparent rounded-full animate-spin"
                  />
                )}
                <span>{submittingStatus ?? 'Publicar anúncio'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}
