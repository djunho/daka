import { useEffect, useState, type FormEvent } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import Button, { buttonClasses } from '../components/Button'
import {
  ApiError,
  apiGetListing,
  apiListCategories,
  apiListConditions,
  apiUpdateListing,
  type ApiCategory,
  type ApiCondition,
  type ApiListingDetail,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { getPortugueseErrorMessage } from '../lib/errors'
import ListingFields from '../components/ListingFields'
import ListingPhotoManager from '../components/ListingPhotoManager'
import {
  EMPTY_LISTING_FORM,
  changedListingFields,
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
  const navigate = useNavigate()
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

  // Save flow: the request in flight and its error.
  const [saving, setSaving] = useState<boolean>(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Photos are saved one action at a time, not by the form. Remembered so that
  // going back to the listing still tells the owner it was updated.
  const [photosChanged, setPhotosChanged] = useState<boolean>(false)

  useEffect(() => {
    if (!validId) return

    // When the id in the URL changes before the responses arrive, they are
    // dropped (same guard as ListingDetail).
    let ignore = false

    setListing(null)
    setPhotosChanged(false)
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

  function handlePhotosChange(updated: ApiListingDetail) {
    setListing(updated)
    setPhotosChanged(true)
  }

  // Saves the fields that changed and clears their error messages.
  function handleFieldChange(changes: Partial<ListingFormValues>) {
    setValues((prev) => ({ ...prev, ...changes }))
    setErrors((prev) => clearFieldErrors(prev, changes))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!listing) return
    setSaveError(null)

    const newErrors = validateListingForm(values)
    setErrors(newErrors)
    if (focusFirstError(newErrors)) return

    const changes = changedListingFields(listingToFormValues(listing), values)
    // No text changed: the backend refuses an empty PATCH, so skip it. The
    // notice still shows when the photos changed, as they are already saved.
    if (Object.keys(changes).length === 0) {
      navigate(`/listing/${listing.id}`, {
        replace: true,
        state: photosChanged ? { notice: 'O teu anúncio foi atualizado.' } : null,
      })
      return
    }

    setSaving(true)
    try {
      await apiUpdateListing(listing.id, changes)
      // replace: Back from the listing must not reopen this form. The Layout
      // shows the notice on the listing page.
      navigate(`/listing/${listing.id}`, {
        replace: true,
        state: { notice: 'O teu anúncio foi atualizado.' },
      })
    } catch (err) {
      setSaveError(
        getPortugueseErrorMessage(err, 'Não foi possível guardar as alterações. Tenta outra vez.', {
          404: 'Este anúncio já não existe: pode ter sido removido.',
        }),
      )
      setSaving(false)
    }
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
          <Link className={buttonClasses()} to="/">Voltar ao início</Link>
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
          <Link className={buttonClasses()} to={`/listing/${listingId}`}>Voltar ao anúncio</Link>
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
          <Link className={buttonClasses()} to={`/listing/${listing.id}`}>Ver anúncio</Link>
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

        {/* Photos first: they are saved one action at a time, while the text
            fields below wait for "Guardar alterações". */}
        <div className="border-b border-line pb-6 mb-6">
          <ListingPhotoManager listing={listing} onChange={handlePhotosChange} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {saveError && (
            <p
              role="alert"
              className="bg-accent/10 border border-accent/20 rounded-xl p-4 text-sm text-accent"
            >
              {saveError}
            </p>
          )}

          <ListingFields
            values={values}
            errors={errors}
            categories={categories}
            conditions={conditions}
            disabled={saving}
            onChange={handleFieldChange}
          />

          <div className="pt-6 border-t border-line flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
            {/* While saving, leaving would hide whether the changes were kept. */}
            <Link
              to={`/listing/${listing.id}`}
              aria-disabled={saving}
              tabIndex={saving ? -1 : undefined}
              onClick={(e) => {
                if (saving) e.preventDefault()
              }}
              className={buttonClasses({ variant: 'ghost', className: 'w-full sm:w-auto' })}
            >
              Cancelar
            </Link>
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              className="w-full sm:w-auto"
            >
              {saving ? 'A guardar…' : 'Guardar alterações'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}
