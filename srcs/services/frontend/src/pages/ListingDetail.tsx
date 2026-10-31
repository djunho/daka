import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ApiError, apiDeleteListing, apiGetListing, type ApiListingDetail } from '../lib/api'
import { categoryLabel, conditionLabel } from '../types/listing'
import ListingGallery from '../components/ListingGallery'
import { useAuth } from '../context/AuthContext'
import Avatar from '../components/Avatar'
import ConfirmDialog from '../components/ConfirmDialog'

// useParams reads the :id piece from the URL (/listing/3 -> id === "3").
// This is the router feature that lets one component serve many listings.
export default function ListingDetail() {
  const { id } = useParams()
  const { user: currentUser } = useAuth()
  const navigate = useNavigate()
  // Anything that is not a positive whole number ("/listing/abc") can never
  // exist, so it goes straight to "not found" without asking the backend.
  const listingId = Number(id)
  const validId = Number.isInteger(listingId) && listingId > 0

  const [listing, setListing] = useState<ApiListingDetail | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [notFound, setNotFound] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Remove flow: the confirmation dialog, the request in flight and its error.
  const [confirmRemove, setConfirmRemove] = useState<boolean>(false)
  const [removing, setRemoving] = useState<boolean>(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  useEffect(() => {
    if (!validId) return

    // Same guard as the Home feed: when the id in the URL changes before the
    // previous response arrives, that stale response is dropped.
    let ignore = false

    // Going from one listing straight to another keeps this page mounted:
    // drop the previous listing so it is never shown under the new URL.
    setListing(null)
    setLoading(true)
    setNotFound(false)
    setError(null)
    apiGetListing(listingId)
      .then((data) => {
        if (ignore) return
        setListing(data)
      })
      .catch((err) => {
        if (ignore) return
        // 404 covers both a listing that never existed and one that was
        // removed: the backend only serves available listings here.
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

  function openRemoveDialog() {
    // A previous failed attempt should not greet the next one.
    setRemoveError(null)
    setConfirmRemove(true)
  }

  function handleRemove() {
    setRemoving(true)
    setRemoveError(null)
    apiDeleteListing(listingId)
      .then(() => {
        // replace: Back must not return to a listing that no longer exists.
        // The Layout shows the notice on the next page (88h).
        navigate('/', { replace: true, state: { notice: 'O teu anúncio foi removido.' } })
      })
      .catch(() => {
        setRemoveError('Não foi possível remover o anúncio. Tenta outra vez.')
        setRemoving(false)
      })
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
          <Link className="btn" to="/">Voltar ao início</Link>
        </div>
      </main>
    )
  }

  // `|| !listing` lets TypeScript know `listing` is set from here on.
  // The id check covers the first render after the URL changes, before the
  // effect above has run and cleared the previous listing.
  if (loading || !listing || listing.id !== listingId) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Read by screen readers only; the skeleton below is just visual. */}
        <p role="status" className="sr-only">A carregar anúncio…</p>
        {/* Skeleton: a grey outline of the page while it loads. */}
        <div
          className="flex flex-col gap-8 md:grid md:grid-cols-[3fr_2fr] animate-pulse"
          aria-hidden="true"
        >
          <div className="aspect-[4/3] rounded-2xl bg-surface border border-line" />
          <div className="space-y-4">
            <div className="h-8 w-3/4 rounded bg-surface" />
            <div className="h-4 w-1/2 rounded bg-surface" />
            <div className="h-4 w-2/3 rounded bg-surface" />
            <div className="h-24 w-full rounded bg-surface" />
          </div>
        </div>
      </main>
    )
  }

  const { title, wish, listing_dsc, category, condition, listing_location, owner, images, created_at } = listing

  // "25 de outubro de 2026"
  const publishedAt = new Date(created_at).toLocaleDateString('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  // Only the owner can edit or remove the listing.
  const isOwner = currentUser?.id === owner.id

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-col gap-8 md:grid md:grid-cols-[3fr_2fr]">
        {/* Left column: photos. */}
        <section aria-label="Fotografias">
          <ListingGallery key={listing.id} images={images} title={title} category={category} />
        </section>

        {/* Right column: listing info and owner card (88d). */}
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="text-xs font-semibold bg-surface text-label border border-line px-2.5 py-1 rounded-full">
                {categoryLabel(category)}
              </span>
              <span className="text-xs font-semibold bg-surface text-label border border-line px-2.5 py-1 rounded-full">
                {conditionLabel(condition)}
              </span>
            </div>
            <h1 className="font-display text-3xl font-bold text-ink leading-tight wrap-break-word">
              {title}
            </h1>
            <p className="text-sm text-muted mt-2">
              {listing_location && (
                <>
                  <span aria-hidden="true">📍</span> {listing_location} ·{' '}
                </>
              )}
              Publicado a {publishedAt}
            </p>
          </div>

          {wish && (
            <div className="bg-surface border border-line rounded-xl p-4">
              <span className="block text-xs font-medium text-muted mb-1">Em troca, procura</span>
              <p className="font-semibold text-accent wrap-break-word">
                <span aria-hidden="true">⇄</span> {wish}
              </p>
            </div>
          )}

          <div>
            <h2 className="font-display text-lg font-bold text-ink mb-2">Descrição</h2>
            {listing_dsc ? (
              <p className="text-ink whitespace-pre-line wrap-break-word">{listing_dsc}</p>
            ) : (
              <p className="text-sm text-muted">O anunciante não escreveu uma descrição.</p>
            )}
          </div>

          {/* Owner card */}
          <div className="bg-surface border border-line rounded-2xl p-4 shadow-sm">
            <span className="block text-xs font-medium text-muted mb-3">Anunciado por</span>
            <div className="flex items-center gap-3">
              <Avatar avatar={owner.avatar} user_name={owner.user_name} size="sm" />
              <div className="min-w-0">
                <Link
                  to={`/users/${owner.id}`}
                  className="font-semibold text-ink hover:text-brand hover:underline wrap-break-word"
                >
                  {owner.user_name}
                </Link>
                {owner.user_location && (
                  <p className="text-xs text-muted">
                    <span aria-hidden="true">📍</span> {owner.user_location}
                  </p>
                )}
              </div>
            </div>
            {isOwner && (
              // The font classes sit on this div on purpose: index.css has
              // `button { font: inherit }` outside any @layer, which beats
              // Tailwind's text-*/font-* utilities on the button itself.
              <div className="mt-4 pt-4 border-t border-line space-y-3 text-sm font-semibold">
                <p className="font-medium text-brand">Este é o teu anúncio.</p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/listing/${listing.id}/edit`}
                    className="bg-brand text-white rounded-xl px-4 py-2 hover:opacity-90 transition-opacity"
                  >
                    Editar anúncio
                  </Link>
                  <button
                    type="button"
                    onClick={openRemoveDialog}
                    className="text-accent border border-accent rounded-xl px-4 py-2 hover:bg-accent hover:text-white transition-colors"
                  >
                    Remover anúncio
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <Link className="btn" to="/">Voltar ao início</Link>
      </div>
      {isOwner && (
        <ConfirmDialog
          open={confirmRemove}
          title="Remover anúncio"
          message={`Tens a certeza de que queres remover «${title}»? Deixa de aparecer na plataforma e as propostas de troca abertas são canceladas.`}
          confirmLabel="Sim, remover"
          busyLabel="A remover…"
          busy={removing}
          error={removeError}
          onConfirm={handleRemove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </main>
  )
}
