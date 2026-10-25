import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ApiError, apiGetListing, type ApiListingDetail } from '../lib/api'
import { categoryLabel, conditionLabel } from '../types/listing'

// useParams reads the :id piece from the URL (/listing/3 -> id === "3").
// This is the router feature that lets one component serve many listings.
export default function ListingDetail() {
  const { id } = useParams()
  // Anything that is not a positive whole number ("/listing/abc") can never
  // exist, so it goes straight to "not found" without asking the backend.
  const listingId = Number(id)
  const validId = Number.isInteger(listingId) && listingId > 0

  const [listing, setListing] = useState<ApiListingDetail | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [notFound, setNotFound] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!validId) return

    // Same guard as the Home feed: when the id in the URL changes before the
    // previous response arrives, that stale response is dropped.
    let ignore = false

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

  if (!validId || notFound) {
    return (
      <main className="page">
        <h1 className="page-title">Anúncio não encontrado</h1>
        <p className="page-text">Não há nenhum anúncio com o id {id}.</p>
        <Link className="btn" to="/">Voltar ao início</Link>
      </main>
    )
  }

  if (error) {
    return (
      <main className="page">
        <p className="page-text" role="alert">{error}</p>
        <Link className="btn" to="/">Voltar ao início</Link>
      </main>
    )
  }

  if (loading || !listing) {
    return (
      <main className="page">
        <p className="page-text" role="status">A carregar anúncio…</p>
      </main>
    )
  }

  const { title, wish, listing_dsc, category, condition, listing_location, owner, cover_image } = listing

  return (
    <main className="page">
      {cover_image && (
        <img
          src={cover_image}
          alt={title}
          className="w-full aspect-[4/3] object-cover rounded-2xl border border-line mb-6"
        />
      )}
      <h1 className="page-title">{title}</h1>
      {wish && (
        <p className="page-text">
          <span className="swap-arrow" aria-hidden="true">⇄</span>{' '}
          quer: <strong>{wish}</strong>
        </p>
      )}
      <p className="page-text">
        {categoryLabel(category)} · {conditionLabel(condition)} ·{' '}
        {listing_location && <>{listing_location} ·{' '}</>}
        <Link
          to={`/users/${owner.id}`}
          className="text-brand font-medium hover:underline"
        >
          @{owner.user_name}
        </Link>
      </p>
      {listing_dsc && <p className="page-text whitespace-pre-line">{listing_dsc}</p>}
      <p className="page-text">
        (Página de detalhe em construção — o botão de propor troca entra aqui.)
      </p>
      <Link className="btn" to="/">Voltar ao início</Link>
    </main>
  )
}
