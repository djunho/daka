import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import Button, { buttonClasses } from '../components/Button'
import ListingCard, { EMPTY_STATE_CLASSES, LISTING_GRID_CLASSES } from '../components/ListingCard'
import { useAuth } from '../context/AuthContext'
import { useFavorites } from '../context/FavoritesContext'
import { ApiError, apiGetFavorites, type ApiListingSummary } from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'

// Same page size as the Home feed, so the grid fills the same way.
const PAGE_SIZE = 12

// The listings the user saved, in the same grid as the Home page. Removing a
// favorite (the heart on a card) takes the card off the list as soon as the
// backend confirms it; until then the heart is already empty.
export default function Favorites() {
  const { logout } = useAuth()
  const { ready, isFavorite, isPending } = useFavorites()

  const [listings, setListings] = useState<ApiListingSummary[]>([])
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState<boolean>(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  // Bumped by "Tentar outra vez" and when every loaded card was removed, to
  // load the first page again.
  const [attempt, setAttempt] = useState<number>(0)
  // Bumped when the list starts over, so a late "Carregar mais" answer that
  // belongs to the previous list is dropped (same idea as the Home feed).
  const listRequest = useRef(0)

  function handleError(err: unknown, fallback: string, show: (message: string) => void) {
    if (err instanceof ApiError && err.status === 401) {
      // The session expired. Clearing it lets RequireAuth send them to login.
      void logout()
      return
    }
    show(getPortugueseErrorMessage(err, fallback))
  }

  useEffect(() => {
    const controller = new AbortController()
    const request = ++listRequest.current

    setLoading(true)
    setError(null)
    setLoadingMore(false)
    setMoreError(null)
    apiGetFavorites({ limit: PAGE_SIZE }, controller.signal)
      .then((page) => {
        if (listRequest.current !== request) return
        setListings(page.items)
        setTotal(page.total)
      })
      .catch((err) => {
        if (listRequest.current !== request) return
        handleError(err, 'Não foi possível carregar os favoritos. Tenta outra vez.', setError)
      })
      .finally(() => {
        if (listRequest.current !== request) return
        setLoading(false)
      })

    return () => {
      // Leaving the page or starting over: this answer is no longer wanted.
      listRequest.current += 1
      controller.abort()
    }
    // handleError only uses logout, which does not change what is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  // A card leaves the list once its removal is confirmed: no longer a favorite
  // and no request running. Before the favorites are known (`ready`), every
  // card the backend sent stays.
  const removed = (listing: ApiListingSummary) =>
    ready && !isFavorite(listing.id) && !isPending(listing.id)
  const visible = listings.filter((listing) => !removed(listing))
  const shownTotal = Math.max(0, total - (listings.length - visible.length))
  const allLoadedRemoved = !loading && !error && listings.length > 0 && visible.length === 0

  // Every card on screen was removed, but there are more on the server:
  // bring in the next ones instead of showing an empty page.
  useEffect(() => {
    if (allLoadedRemoved && shownTotal > 0) setAttempt((a) => a + 1)
  }, [allLoadedRemoved, shownTotal])

  function loadMore() {
    // A second click before the page arrives would ask for the same offset.
    if (loadingMore) return
    const request = listRequest.current

    setLoadingMore(true)
    setMoreError(null)
    // Removed favorites are gone from the server's list too, so the next page
    // starts after the cards still on screen.
    apiGetFavorites({ limit: PAGE_SIZE, offset: visible.length })
      .then((page) => {
        if (listRequest.current !== request) return
        // A removal still running can make the offset one short: skip a card
        // that is already on screen rather than show it twice.
        setListings((prev) => {
          const known = new Set(prev.map((listing) => listing.id))
          return [...prev, ...page.items.filter((listing) => !known.has(listing.id))]
        })
        setTotal(page.total + (listings.length - visible.length))
      })
      .catch((err) => {
        if (listRequest.current !== request) return
        handleError(err, 'Não foi possível carregar mais favoritos. Tenta outra vez.', setMoreError)
      })
      .finally(() => {
        if (listRequest.current !== request) return
        setLoadingMore(false)
      })
  }

  return (
    <main className="px-4 sm:px-6 pt-8 pb-12">
      <h1 className="font-display text-3xl font-bold text-ink">Favoritos</h1>
      {!loading && !error && (
        <p className="text-muted text-sm mt-2 mb-4">
          {shownTotal} {shownTotal === 1 ? 'artigo guardado' : 'artigos guardados'}
        </p>
      )}

      {/* Loading comes before the empty check, or "nothing here" would flash. */}
      {error ? (
        <div className={`${EMPTY_STATE_CLASSES} mt-4`}>
          <p role="alert" className="mb-4">{error}</p>
          <Button onClick={() => setAttempt((a) => a + 1)}>Tentar outra vez</Button>
        </div>
      ) : loading || (allLoadedRemoved && shownTotal > 0) ? (
        <p className={`${EMPTY_STATE_CLASSES} mt-4`} role="status">A carregar favoritos…</p>
      ) : visible.length === 0 ? (
        <div className={EMPTY_STATE_CLASSES}>
          <p className="mb-4">Ainda não tens artigos guardados nos favoritos. Explora as trocas disponíveis!</p>
          <Link to="/" className={buttonClasses({ variant: 'primary' })}>Voltar ao início</Link>
        </div>
      ) : (
        <div className={LISTING_GRID_CLASSES}>
          {visible.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      {!loading && !error && visible.length > 0 && visible.length < shownTotal && (
        <div className="flex flex-col items-center gap-2 mt-8">
          <Button onClick={loadMore} loading={loadingMore}>
            {loadingMore ? 'A carregar…' : 'Carregar mais'}
          </Button>
          {moreError && <p role="alert" className="text-sm text-accent">{moreError}</p>}
        </div>
      )}
    </main>
  )
}
