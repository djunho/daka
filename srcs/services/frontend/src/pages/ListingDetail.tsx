import { useEffect, useId, useRef, useState } from 'react'
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ApiError,
  apiCreateNegotiation,
  apiDeleteListing,
  apiGetListing,
  listingDocumentUrl,
  type ApiListingDetail,
} from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'
import { categoryLabel, conditionLabel } from '../types/listing'
import ListingGallery from '../components/ListingGallery'
import { useAuth } from '../context/AuthContext'
import Avatar from '../components/Avatar'
import Icon from '../components/Icon'
import Button, { buttonClasses } from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import DocumentItem from '../components/DocumentItem'
import MessageCard from '../components/MessageCard'

// POST /negotiations answers 409 both when the listing can no longer be
// negotiated and when this pair already has a cancelled negotiation for it.
// The backend sends no error code, so only this detail tells them apart.
const CANCELLED_NEGOTIATION_DETAIL = 'A cancelled negotiation cannot be reopened.'

// useParams reads the :id piece from the URL (/listing/3 -> id === "3").
// This is the router feature that lets one component serve many listings.
export default function ListingDetail() {
  const { id } = useParams()
  const { user: currentUser, loading: authLoading, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
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

  // Start-negotiation flow: the request in flight and its error.
  const [starting, setStarting] = useState<boolean>(false)
  const [startError, setStartError] = useState<string | null>(null)
  const startErrorId = useId()
  const startErrorRef = useRef<HTMLParagraphElement>(null)
  // Bumped by each new request and when the user leaves this listing, so only
  // the latest request can act, and a late response does not pull them to a
  // negotiation after they have already moved on.
  const startRequest = useRef(0)

  // The button is disabled during the request, which drops the keyboard focus.
  // Moving it to the error gives it a predictable place to land.
  useEffect(() => {
    if (startError) startErrorRef.current?.focus()
  }, [startError])

  useEffect(() => {
    return () => {
      startRequest.current += 1
    }
  }, [listingId])

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
    setStarting(false)
    setStartError(null)
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

  function goToLogin() {
    // Login sends the user back here; nothing is created until they click again.
    navigate('/login', { state: { from: location.pathname } })
  }

  function handleStartNegotiation() {
    if (starting) return
    if (!currentUser) {
      goToLogin()
      return
    }

    const request = ++startRequest.current
    setStarting(true)
    setStartError(null)
    apiCreateNegotiation(listingId)
      .then((negotiation) => {
        if (startRequest.current !== request) return
        navigate(`/negotiations/${negotiation.id}`)
      })
      .catch(async (err) => {
        if (startRequest.current !== request) return
        setStarting(false)

        if (err instanceof ApiError && err.status === 401) {
          // The session expired after the page loaded. Clear it first, or the
          // login page would see a user and send them straight back here.
          await logout()
          // The user may have left the page while logout was running.
          if (startRequest.current !== request) return
          goToLogin()
          return
        }
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
          return
        }
        if (err instanceof ApiError && err.status === 409 && err.message === CANCELLED_NEGOTIATION_DETAIL) {
          setStartError('A tua negociação deste anúncio foi cancelada e não pode ser reaberta.')
          return
        }
        setStartError(getPortugueseErrorMessage(
          err,
          'Não foi possível iniciar a negociação. Tenta outra vez.',
          { 409: 'Este anúncio já não está disponível para negociação.' },
        ))
      })
  }

  if (!validId || notFound) {
    return (
      <MessageCard
        title="Anúncio não encontrado"
        text="O anúncio que procuras não existe ou já foi removido."
        action={<Link className={buttonClasses()} to="/">Voltar ao início</Link>}
      />
    )
  }

  if (error) {
    return (
      <MessageCard
        alert
        text={error}
        action={<Link className={buttonClasses()} to="/">Voltar ao início</Link>}
      />
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
                  <Icon name="location" size={14} className="inline-block align-[-2px] mr-0.5" />{listing_location} ·{' '}
                </>
              )}
              Publicado a {publishedAt}
            </p>
          </div>

          {wish && (
            <div className="bg-surface border border-line rounded-xl p-4">
              <span className="block text-xs font-medium text-muted mb-1">Em troca, procura</span>
              <p className="font-semibold text-accent wrap-break-word">
                <Icon name="swap" size={16} className="inline-block align-[-3px] mr-1" />{wish}
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

          {listing.documents.length > 0 && (
            <div>
              <h2 id="listing-documents" className="font-display text-lg font-bold text-ink mb-2">Documentos</h2>
              <ul aria-labelledby="listing-documents" className="space-y-2">
                {listing.documents.map((doc) => (
                  <DocumentItem
                    key={doc.id}
                    name={doc.original_name}
                    sizeBytes={doc.size_bytes}
                    pageCount={doc.page_count}
                    actions={
                      // Opening a document needs a session. A visitor gets the
                      // way to log in instead of a link the backend would
                      // answer with 401 (an error in the browser console).
                      currentUser ? (
                        <>
                          <a
                            href={listingDocumentUrl(listing.id, doc.id)}
                            target="_blank"
                            rel="noopener"
                            className={buttonClasses({ variant: 'link', size: 'sm' })}
                          >
                            Abrir<span className="sr-only"> {doc.original_name}</span>
                          </a>
                          <a
                            href={listingDocumentUrl(listing.id, doc.id)}
                            download={doc.original_name}
                            className={buttonClasses({ variant: 'link', size: 'sm' })}
                          >
                            Descarregar<span className="sr-only"> {doc.original_name}</span>
                          </a>
                        </>
                      ) : (
                        <Button variant="link" size="sm" onClick={goToLogin}>
                          Inicia sessão para abrir<span className="sr-only"> {doc.original_name}</span>
                        </Button>
                      )
                    }
                  />
                ))}
              </ul>
            </div>
          )}

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
                    <Icon name="location" size={12} className="inline-block align-[-1px] mr-0.5" />{owner.user_location}
                  </p>
                )}
              </div>
            </div>
            {isOwner && (
              <div className="mt-4 pt-4 border-t border-line space-y-3">
                <p className="text-sm font-medium text-brand">Este é o teu anúncio.</p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/listing/${listing.id}/edit`}
                    className={buttonClasses({ variant: 'primary', size: 'sm' })}
                  >
                    Editar anúncio
                  </Link>
                  <Button variant="dangerOutline" size="sm" onClick={openRemoveDialog}>
                    Remover anúncio
                  </Button>
                </div>
              </div>
            )}
            {/* Waits for the session check: until then every visitor looks
                logged out, and the owner would see this flash. */}
            {!isOwner && !authLoading && (
              <div className="mt-4 pt-4 border-t border-line space-y-3">
                <Button
                  variant="primary"
                  className="w-full"
                  loading={starting}
                  onClick={handleStartNegotiation}
                  aria-describedby={startError ? startErrorId : undefined}
                >
                  {starting ? 'A abrir negociação…' : 'Iniciar negociação'}
                </Button>
                {startError && (
                  <p
                    id={startErrorId}
                    ref={startErrorRef}
                    tabIndex={-1}
                    role="alert"
                    className="text-sm text-accent"
                  >
                    {startError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <Link className={buttonClasses()} to="/">Voltar ao início</Link>
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
