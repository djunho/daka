import { useState, useEffect } from 'react'
import ListingCard from '../components/ListingCard'
import { categoryLabel } from '../types/listing'
import { apiListCategories, type ApiCategory, apiListListings, type ApiListingSummary } from '../lib/api'

const PAGE_SIZE = 12

export default function Home() {
  // Category filter — the chosen Category ID or null to show all
  const [active, setActive] = useState<number | null>(null)
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [listings, setListings] = useState<ApiListingSummary[]>([])
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState<boolean>(false)
  const [moreError, setMoreError] = useState<string | null>(null)

  useEffect(() => {
    apiListCategories()
      .then((cats) => setCategories(cats))
      .catch(() => {
        // If this fails the chips just don't appear; the feed keeps working.
      })
  }, [])

  useEffect(() => {
    // Set to true by the cleanup below when `active` changes again. A slow
    // response for an old category then arrives with ignore === true and is
    // dropped, instead of overwriting the listings of the chip now selected.
    let ignore = false

    setLoading(true)
    setError(null)
    setMoreError(null)
    apiListListings({ category_id: active ?? undefined, limit: PAGE_SIZE })
      .then((page) => {
        if (ignore) return
        setListings(page.items)
        setTotal(page.total)
      })
      .catch(() => {
        if (ignore) return
        setError('Não foi possível carregar os anúncios. Tenta outra vez.')
      })
      .finally(() => {
        if (ignore) return
        setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [active])

  function loadMore() {
    // A second click before the first page arrives would ask for the same
    // offset again and add those listings twice.
    if (loadingMore) return
    setLoadingMore(true)
    setMoreError(null)
    apiListListings({ category_id: active ?? undefined, limit: PAGE_SIZE, offset: listings.length })
      .then((page) => {
        setListings((prev) => [...prev, ...page.items])
        setTotal(page.total)
      })
      .catch(() => {
        setMoreError('Não foi possível carregar mais anúncios. Tenta outra vez.')
      })
      .finally(() => {
        setLoadingMore(false)
      })
  }

  const activeCategory = categories.find((c) => c.id === active)

  return (
    <main>
      <section className="hero">
        <h1 className="hero-title">
          Não compres. <span className="swap-word">Troca.</span>
        </h1>
        <p className="hero-sub">
          Dá aquilo que já não usas e recebe algo que precisas.<br/>
          <span className="hero-tagline">Sem dinheiro: só toma-lá-dá-cá.</span>
        </p>
      </section>

      <nav className="chips" aria-label="Filtrar por categoria">
        {categories.map((cat) => (
          <button
            key={cat.id}
            className="chip"
            aria-pressed={active === cat.id}
            onClick={() => setActive(active === cat.id ? null : cat.id)}
            disabled={loadingMore}
          >
            {categoryLabel(cat)}
          </button>
        ))}
      </nav>

      <section className="feed">
        {!loading && !error && (
          <p className="feed-count">
            {total} {total === 1 ? 'anúncio' : 'anúncios'}
            {activeCategory ? ` em ${categoryLabel(activeCategory)}` : ''}
          </p>
        )}

        {/* Order matters: loading must come before the empty check, or the
            "nothing here" message would flash while the request is running. */}
        {error ? (
          <p className="empty" role="alert">{error}</p>
        ) : loading ? (
          <p className="empty" role="status">A carregar anúncios…</p>
        ) : listings.length === 0 ? (
          <p className="empty">Ainda não há nada nesta categoria. Sê o primeiro a publicar!</p>
        ) : (
          <div className="grid">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}

        {!loading && !error && listings.length < total && (
          <div className="flex flex-col items-center gap-2 mt-8">
            <button
              className="btn disabled:opacity-60"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'A carregar…' : 'Carregar mais'}
            </button>
            {moreError && <p role="alert" className="text-sm text-accent">{moreError}</p>}
          </div>
        )}
      </section>
    </main>
  )
}
