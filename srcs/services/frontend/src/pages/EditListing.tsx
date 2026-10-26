import { useEffect, useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ApiError,
  apiGetListing,
  apiListCategories,
  apiListConditions,
  type ApiCategory,
  type ApiCondition,
  type ApiListingDetail,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import ListingFields from '../components/ListingFields'
import {
  EMPTY_LISTING_FORM,
  clearFieldErrors,
  focusFirstError,
  listingToFormValues,
  validateListingForm,
  type ListingFormErrors,
  type ListingFormValues,
} from '../lib/listingForm'

// /listing/:id/edit: the owner changes a listing, with the same fields as
// the publish page, already filled with the listing's current data.
export default function EditListing() {
  const { id } = useParams()
  const { user: currentUser } = useAuth()
  // Same check as ListingDetail: an id that is not a positive whole number
  // can never exist.
  const listingId = Number(id)
  const validId = Number.isInteger(listingId) && listingId > 0

  const [listing, setListing] = useState<ApiListingDetail | null>(null)
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [conditions, setConditions] = useState<ApiCondition[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [notFound, setNotFound] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const [values, setValues] = useState<ListingFormValues>(EMPTY_LISTING_FORM)
  const [errors, setErrors] = useState<ListingFormErrors>({})

  useEffect(() => {
    if (!validId) return

    // When the id in the URL changes before the responses arrive, they are
    // dropped (same guard as ListingDetail).
    let ignore = false

    setListing(null)
    setLoading(true)
    setNotFound(false)
    setError(null)
    // The form needs the listing and both option lists before it can show.
    Promise.all([apiGetListing(listingId), apiListCategories(), apiListConditions()])
      .then(([data, cats, conds]) => {
        if (ignore) return
        setListing(data)
        setCategories(cats)
        setConditions(conds)
        setValues(listingToFormValues(data))
        setErrors({})
      })
      .catch((err) => {
        if (ignore) return
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          setError('Não foi possível carregar o anúncio. Tenta outra vez.')
        }
      })
      .finally(() => {
        if (ignore) return
        setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [listingId, validId])

  // Saves the fields that changed and clears their error messages.
  function handleFieldChange(changes: Partial<ListingFormValues>) {
    setValues((prev) => ({ ...prev, ...changes }))
    setErrors((prev) => clearFieldErrors(prev, changes))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const newErrors = validateListingForm(values)
    setErrors(newErrors)
    if (focusFirstError(newErrors)) return
    // Next step: send the changes with PATCH /listings/{id}.
  }

  if (!validId || notFound) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-surface border border-line rounded-2xl p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl font-bold text-ink mb-2">
            Anúncio não encontrado
          </h1>
          <p className="text-sm text-muted mb-6">
            O anúncio que procuras não existe ou já foi removido.
          </p>
          <Link className="btn" to="/">Voltar ao início</Link>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-surface border border-line rounded-2xl p-8 text-center shadow-sm">
          <p role="alert" className="text-sm text-muted mb-6">
            {error}
          </p>
          <Link className="btn" to={`/listing/${listingId}`}>Voltar ao anúncio</Link>
        </div>
      </main>
    )
  }

  // The id check covers the first render after the URL changes, before the
  // effect above has run and cleared the previous listing.
  if (loading || !listing || listing.id !== listingId) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Read by screen readers only; the skeleton below is just visual. */}
        <p role="status" className="sr-only">A carregar anúncio…</p>
        <div
          className="bg-surface border border-line rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 animate-pulse"
          aria-hidden="true"
        >
          <div className="h-8 w-1/2 rounded bg-paper" />
          <div className="h-10 w-full rounded-xl bg-paper" />
          <div className="h-10 w-full rounded-xl bg-paper" />
          <div className="h-24 w-full rounded-xl bg-paper" />
        </div>
      </main>
    )
  }

  // The backend refuses edits from anyone else (403); this only spares them
  // a form they could never save.
  if (currentUser?.id !== listing.owner.id) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-surface border border-line rounded-2xl p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl font-bold text-ink mb-2">
            Não podes editar este anúncio
          </h1>
          <p className="text-sm text-muted mb-6">
            Só quem publicou o anúncio o pode alterar.
          </p>
          <Link className="btn" to={`/listing/${listing.id}`}>Ver anúncio</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-surface border border-line rounded-2xl p-6 sm:p-8 shadow-sm">
        <div className="border-b border-line pb-4 mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Editar anúncio</h1>
          <p className="text-sm text-muted mt-1 wrap-break-word">{listing.title}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <ListingFields
            values={values}
            errors={errors}
            categories={categories}
            conditions={conditions}
            disabled={false}
            onChange={handleFieldChange}
          />

          {/* Font classes on the wrapper: index.css has `button { font: inherit }`
              outside any @layer, which beats text and font utilities on the
              button itself. */}
          <div className="pt-6 border-t border-line flex flex-col-reverse sm:flex-row items-center justify-end gap-3 text-sm font-semibold">
            <Link
              to={`/listing/${listing.id}`}
              className="w-full sm:w-auto px-5 py-2.5 rounded-full text-muted hover:text-ink text-center transition-colors"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              className="w-full sm:w-auto px-6 py-2.5 rounded-full bg-brand text-surface hover:opacity-95 transition-opacity"
            >
              Guardar alterações
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
