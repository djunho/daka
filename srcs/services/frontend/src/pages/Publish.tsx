import { useState, useEffect, useCallback, type ChangeEvent } from 'react'
import {
  apiListCategories,
  apiListConditions,
  ApiCategory,
  ApiCondition,
  ApiError,
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
  onRemove: (index: number) => void
}

function PhotoThumbnail({ file, index, onRemove }: PhotoThumbnailProps) {
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

      {/* Badge da Foto Principal (Capa) */}
      {index === 0 && (
        <span className="absolute bottom-1.5 left-1.5 bg-ink/80 text-surface text-[10px] font-semibold px-2 py-0.5 rounded-md backdrop-blur-xs">
          Principal
        </span>
      )}

      {/* Botão de remoção */}
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={`Remover foto ${index + 1}`}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-surface/90 text-accent hover:bg-surface border border-line/40 flex items-center justify-center text-xs shadow-sm transition-transform hover:scale-110"
      >
        ✕
      </button>
    </div>
  )
}

export default function Publish() {
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [conditions, setConditions] = useState<ApiCondition[]>([])
  const [isLoadingMeta, setIsLoadingMeta] = useState(true)
  const [metaError, setMetaError] = useState<string | null>(null)

  // Estado dos campos do formulário
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [conditionId, setConditionId] = useState<number | ''>('')
  const [location, setLocation] = useState('')
  const [wish, setWish] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})

  // Estado das fotografias
  const [photos, setPhotos] = useState<File[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)

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

    for (const f of files) {
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
  }

  // Validação client-side rigorosa
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
    return Object.keys(newErrors).length === 0
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-surface border border-line rounded-2xl p-6 sm:p-8 shadow-sm">
        {/* Cabeçalho */}
        <div className="border-b border-line pb-4 mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Publicar anúncio</h1>
          <p className="text-sm text-muted mt-1">
            Regista um artigo que já não usas e encontra o que procuras em troca.
          </p>
        </div>

        {/* Estado: A carregar */}
        {isLoadingMeta && (
          <div className="py-12 text-center">
            <div className="inline-block w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-muted">A carregar opções de publicação…</p>
          </div>
        )}

        {/* Estado: Erro ao carregar */}
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

        {/* Formulário com Campos */}
        {!isLoadingMeta && !metaError && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              validate()
            }}
            className="space-y-6"
            noValidate
          >
            {/* Título */}
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
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }))
                }}
                maxLength={150}
                placeholder="Ex.: Bicicleta de montanha em bom estado"
                className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none transition-colors ${
                  errors.title ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
                }`}
              />
              {errors.title && <p className="text-xs text-accent mt-1">{errors.title}</p>}
            </div>

            {/* Categoria e Condição em grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="category" className="block text-xs uppercase tracking-wider font-bold text-muted mb-1.5">
                  Categoria <span className="text-accent">*</span>
                </label>
                <select
                  id="category"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value ? Number(e.target.value) : '')
                    if (errors.category_id) setErrors((prev) => ({ ...prev, category_id: undefined }))
                  }}
                  className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none transition-colors ${
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
                {errors.category_id && <p className="text-xs text-accent mt-1">{errors.category_id}</p>}
              </div>

              <div>
                <label htmlFor="condition" className="block text-xs uppercase tracking-wider font-bold text-muted mb-1.5">
                  Estado do artigo <span className="text-accent">*</span>
                </label>
                <select
                  id="condition"
                  value={conditionId}
                  onChange={(e) => {
                    setConditionId(e.target.value ? Number(e.target.value) : '')
                    if (errors.condition_id) setErrors((prev) => ({ ...prev, condition_id: undefined }))
                  }}
                  className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none transition-colors ${
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
                {errors.condition_id && <p className="text-xs text-accent mt-1">{errors.condition_id}</p>}
              </div>
            </div>

            {/* Localização com Autocomplete */}
            <div>
              <LocationAutocomplete
                id="listing_location"
                label="Localização de preferência"
                value={location}
                placeholder="Escreve uma localidade (ex.: Guimarães, Porto, Lisboa)"
                onChange={(val) => {
                  setLocation(val)
                  if (errors.listing_location) setErrors((prev) => ({ ...prev, listing_location: undefined }))
                }}
              />
              {errors.listing_location && <p className="text-xs text-accent mt-1">{errors.listing_location}</p>}
            </div>

            {/* O que procuro em troca (Wish) */}
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
                value={wish}
                onChange={(e) => {
                  setWish(e.target.value)
                  if (errors.wish) setErrors((prev) => ({ ...prev, wish: undefined }))
                }}
                maxLength={1000}
                placeholder="Ex.: Livros de ficção científica, jogos de tabuleiro ou material de pintura"
                className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none transition-colors ${
                  errors.wish ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
                }`}
              />
              {errors.wish && <p className="text-xs text-accent mt-1">{errors.wish}</p>}
            </div>

            {/* Descrição */}
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
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  if (errors.listing_dsc) setErrors((prev) => ({ ...prev, listing_dsc: undefined }))
                }}
                maxLength={2000}
                placeholder="Descreve o teu artigo com mais pormenores: tempo de utilização, funcionamento, acessórios incluídos ou pequenas marcas de desgaste."
                className={`w-full bg-paper border rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none transition-colors resize-y ${
                  errors.listing_dsc ? 'border-accent focus:border-accent' : 'border-line focus:border-brand'
                }`}
              />
              {errors.listing_dsc && <p className="text-xs text-accent mt-1">{errors.listing_dsc}</p>}
            </div>

            {/* Fotografias */}
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
                    key={`${file.name}-${file.lastModified}-${index}`}
                    file={file}
                    index={index}
                    onRemove={handleRemovePhoto}
                  />
                ))}

                {photos.length < 6 && (
                  <label className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl border-2 border-dashed border-line hover:border-brand bg-paper/50 hover:bg-paper flex flex-col items-center justify-center cursor-pointer transition-colors text-muted hover:text-brand shrink-0">
                    <span className="text-2xl leading-none font-light">+</span>
                    <span className="text-[11px] font-medium mt-1">Adicionar</span>
                    <input
                      type="file"
                      accept={IMAGE_ACCEPT}
                      multiple
                      className="hidden"
                      onChange={handlePhotoSelect}
                    />
                  </label>
                )}
              </div>

              {photoError && <p className="text-xs text-accent mt-2">{photoError}</p>}
            </div>

            {/* No próximo passo adicionaremos aqui o botão de submissão e chamada às APIs */}
          </form>
        )}
      </div>
    </main>
  )
}
