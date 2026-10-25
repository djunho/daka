import { useState, useEffect, useCallback, useRef, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  apiListCategories,
  apiListConditions,
  apiCreateListing,
  apiUpdateListing,
  apiUploadListingImage,
  ApiCategory,
  ApiCondition,
  ApiError,
  CreateListingData,
} from '../lib/api'
import LocationAutocomplete from '../components/LocationAutocomplete'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { validateImage, IMAGE_ACCEPT } from '../lib/images'

// Type-safe container for field-level validation messages matching backend schema fields.
interface FormErrors {
  title?: string
  category_id?: string
  condition_id?: string
  listing_location?: string
  wish?: string
  listing_dsc?: string
}

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
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-surface/90 text-accent hover:bg-surface border border-line/40 flex items-center justify-center text-xs shadow-sm transition-transform hover:scale-110"
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
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [conditionId, setConditionId] = useState<number | ''>('')
  const [location, setLocation] = useState('')
  const [wish, setWish] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})

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
        err instanceof ApiError
          ? err.message
          : 'Não foi possível carregar as opções de publicação. Por favor, tenta novamente.',
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

    if (photos.length + files.length > 6) {
      setPhotoError('Podes adicionar no máximo 6 fotografias por anúncio.')
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
    setPhotos((prev) => prev.filter((_, i) => i !== indexToRemove))
    setPhotoError(null)
    if (indexToRemove < uploadedPhotosCountRef.current) {
      uploadedPhotosCountRef.current = Math.max(0, uploadedPhotosCountRef.current - 1)
    }
  }

  // Client-side validation mirroring backend ListingCreateIn schema
  const validate = (): boolean => {
    const newErrors: FormErrors = {}
    const trimmedTitle = title.trim()
    const titleLength = [...trimmedTitle].length

    if (!trimmedTitle) {
      newErrors.title = 'O título do anúncio é obrigatório.'
    } else if (titleLength < 3) {
      newErrors.title = 'O título deve ter pelo menos 3 caracteres visíveis.'
    } else if (titleLength > 150) {
      newErrors.title = 'O título não pode ter mais de 150 caracteres.'
    }

    if (!categoryId) {
      newErrors.category_id = 'Seleciona uma categoria.'
    }

    if (!conditionId) {
      newErrors.condition_id = 'Seleciona o estado do artigo.'
    }

    if ([...location.trim()].length > 100) {
      newErrors.listing_location = 'A localização não pode ter mais de 100 caracteres.'
    }

    if ([...wish.trim()].length > 1000) {
      newErrors.wish = 'O que procuras em troca não pode ter mais de 1000 caracteres.'
    }

    if ([...description.trim()].length > 2000) {
      newErrors.listing_dsc = 'A descrição não pode ter mais de 2000 caracteres.'
    }

    setErrors(newErrors)

    const firstErrorField = (Object.keys(newErrors) as Array<keyof FormErrors>)[0]
    if (firstErrorField) {
      const fieldInputIds: Record<keyof FormErrors, string> = {
        title: 'title',
        category_id: 'category',
        condition_id: 'condition',
        listing_location: 'listing_location',
        wish: 'wish',
        listing_dsc: 'description',
      }
      document.getElementById(fieldInputIds[firstErrorField])?.focus()
      return false
    }

    return true
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
      const payload: CreateListingData = {
        title: title.trim(),
        category_id: Number(categoryId),
        condition_id: Number(conditionId),
        listing_location: location.trim() || null,
        wish: wish.trim() || null,
        listing_dsc: description.trim() || null,
      }

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
        err instanceof ApiError
          ? err.message
          : 'Não foi possível publicar o anúncio. Por favor, tenta novamente.',
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

            {/* Title */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="title" className="text-xs uppercase tracking-wider font-bold text-muted">
                  Título do anúncio <span className="text-accent">*</span>
                </label>
                <span className="text-[11px] text-muted">{[...title].length}/150</span>
              </div>
              <input
                id="title"
                type="text"
                disabled={isSubmitting}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }))
                }}
                maxLength={150}
                placeholder="Ex.: Bicicleta de montanha em bom estado"
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'title-error' : undefined}
                className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  errors.title ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
                }`}
              />
              {errors.title && (
                <p id="title-error" className="text-xs text-accent mt-1">
                  {errors.title}
                </p>
              )}
            </div>

            {/* Category and Condition grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="category" className="block text-xs uppercase tracking-wider font-bold text-muted mb-1.5">
                  Categoria <span className="text-accent">*</span>
                </label>
                <select
                  id="category"
                  disabled={isSubmitting}
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value ? Number(e.target.value) : '')
                    if (errors.category_id) setErrors((prev) => ({ ...prev, category_id: undefined }))
                  }}
                  aria-invalid={Boolean(errors.category_id)}
                  aria-describedby={errors.category_id ? 'category-error' : undefined}
                  className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    errors.category_id ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
                  }`}
                >
                  <option value="">Seleciona uma categoria...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.category_name}
                    </option>
                  ))}
                </select>
                {errors.category_id && (
                  <p id="category-error" className="text-xs text-accent mt-1">
                    {errors.category_id}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="condition" className="block text-xs uppercase tracking-wider font-bold text-muted mb-1.5">
                  Estado do artigo <span className="text-accent">*</span>
                </label>
                <select
                  id="condition"
                  disabled={isSubmitting}
                  value={conditionId}
                  onChange={(e) => {
                    setConditionId(e.target.value ? Number(e.target.value) : '')
                    if (errors.condition_id) setErrors((prev) => ({ ...prev, condition_id: undefined }))
                  }}
                  aria-invalid={Boolean(errors.condition_id)}
                  aria-describedby={errors.condition_id ? 'condition-error' : undefined}
                  className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    errors.condition_id ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
                  }`}
                >
                  <option value="">Seleciona o estado...</option>
                  {conditions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.condition_name}
                    </option>
                  ))}
                </select>
                {errors.condition_id && (
                  <p id="condition-error" className="text-xs text-accent mt-1">
                    {errors.condition_id}
                  </p>
                )}
              </div>
            </div>

            {/* Standardized Location Autocomplete */}
            <div>
              <LocationAutocomplete
                id="listing_location"
                label="Localização de preferência"
                value={location}
                disabled={isSubmitting}
                placeholder="Escreve uma localidade (ex.: Guimarães, Porto, Lisboa)"
                onChange={(val) => {
                  setLocation(val)
                  if (errors.listing_location) setErrors((prev) => ({ ...prev, listing_location: undefined }))
                }}
              />
              {errors.listing_location && (
                <p id="location-error" className="text-xs text-accent mt-1">
                  {errors.listing_location}
                </p>
              )}
            </div>

            {/* What you want in return (Wish) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="wish" className="text-xs uppercase tracking-wider font-bold text-muted">
                  O que procuras em troca? <span className="text-muted font-normal lowercase">(opcional)</span>
                </label>
                <span className="text-[11px] text-muted">{[...wish].length}/1000</span>
              </div>
              <input
                id="wish"
                type="text"
                disabled={isSubmitting}
                value={wish}
                onChange={(e) => {
                  setWish(e.target.value)
                  if (errors.wish) setErrors((prev) => ({ ...prev, wish: undefined }))
                }}
                maxLength={1000}
                placeholder="Ex.: Livros de ficção científica, jogos de tabuleiro ou material de pintura"
                aria-invalid={Boolean(errors.wish)}
                aria-describedby={errors.wish ? 'wish-error' : undefined}
                className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  errors.wish ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
                }`}
              />
              {errors.wish && (
                <p id="wish-error" className="text-xs text-accent mt-1">
                  {errors.wish}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="description" className="text-xs uppercase tracking-wider font-bold text-muted">
                  Descrição detalhada <span className="text-muted font-normal lowercase">(opcional)</span>
                </label>
                <span className="text-[11px] text-muted">{[...description].length}/2000</span>
              </div>
              <textarea
                id="description"
                rows={4}
                disabled={isSubmitting}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  if (errors.listing_dsc) setErrors((prev) => ({ ...prev, listing_dsc: undefined }))
                }}
                maxLength={2000}
                placeholder="Descreve o teu artigo com mais pormenores: tempo de utilização, funcionamento, acessórios incluídos ou pequenas marcas de desgaste."
                aria-invalid={Boolean(errors.listing_dsc)}
                aria-describedby={errors.listing_dsc ? 'description-error' : undefined}
                className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none transition-colors resize-y disabled:opacity-50 disabled:cursor-not-allowed ${
                  errors.listing_dsc ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
                }`}
              />
              {errors.listing_dsc && (
                <p id="description-error" className="text-xs text-accent mt-1">
                  {errors.listing_dsc}
                </p>
              )}
            </div>

            {/* Photos */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs uppercase tracking-wider font-bold text-muted">
                  Fotografias do artigo <span className="text-muted font-normal lowercase">(opcional)</span>
                </label>
                <span className="text-[11px] text-muted">{photos.length}/6</span>
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
                    disabled={isSubmitting}
                    onRemove={handleRemovePhoto}
                  />
                ))}

                {photos.length < 6 && (
                  <label
                    className={`w-24 h-24 sm:w-28 sm:h-28 rounded-xl border-2 border-dashed border-line bg-paper/50 flex flex-col items-center justify-center transition-colors text-muted shrink-0 ${
                      isSubmitting
                        ? 'opacity-40 cursor-not-allowed'
                        : 'hover:border-brand hover:bg-paper hover:text-brand cursor-pointer'
                    }`}
                  >
                    <span className="text-2xl leading-none font-light">+</span>
                    <span className="text-[11px] font-medium mt-1">Adicionar</span>
                    <input
                      type="file"
                      accept={IMAGE_ACCEPT}
                      multiple
                      disabled={isSubmitting}
                      className="hidden"
                      onChange={handlePhotoSelect}
                    />
                  </label>
                )}
              </div>

              {photoError && <p className="text-xs text-accent mt-2">{photoError}</p>}
            </div>

            {/* Form footer actions */}
            <div className="pt-6 border-t border-line flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
              <Link
                to="/"
                className={`w-full sm:w-auto px-5 py-2.5 rounded-full text-sm font-semibold text-muted hover:text-ink text-center transition-colors ${
                  isSubmitting ? 'pointer-events-none opacity-40' : ''
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
