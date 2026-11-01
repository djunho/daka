import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import ListingCard from '../components/ListingCard'
import { categoryLabel } from '../types/listing'
import { apiListCategories, type ApiCategory, apiListListings, type ApiListingSummary } from '../lib/api'

const PAGE_SIZE = 12

export default function Home() {
  // Filters live in the URL (/?q=...&category_id=...&location=...), so they survive a reload and can be shared.
  const [searchParams, setSearchParams] = useSearchParams()
  // A URL typed or edited by hand can bring spaces or more text than the
  // backend accepts (q: 150, location: 100 characters, else 422). Cut in code
  // points, as the backend counts them.
  const q = [...(searchParams.get('q') ?? '').trim()].slice(0, 150).join('')
  const categoryId = Number(searchParams.get('category_id'))
  const active = Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null
  const locationFilter = [...(searchParams.get('location') ?? '').trim()].slice(0, 100).join('')
  const hasFilters = q !== '' || active !== null || locationFilter !== ''

  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [listings, setListings] = useState<ApiListingSummary[]>([])
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState<boolean>(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [locationInput, setLocationInput] = useState(locationFilter)
  // Bumped every time the feed starts over with new filters. A "Carregar
  // mais" response that comes back after that belongs to the old filters,
  // so loadMore drops it instead of appending it to the new list.
  const feedRequest = useRef(0)

  useEffect(() => {
    apiListCategories()
      .then((cats) => setCategories(cats))
      .catch(() => {
        // If this fails the chips just don't appear; the feed keeps working.
      })
  }, [])

  // Keep the field in sync with the URL (back button, "Limpar filtros").
  useEffect(() => {
    setLocationInput(locationFilter)
  }, [locationFilter])

  useEffect(() => {
    // Set to true by the cleanup below when a filter changes again. A slow
    // response for the old filters then arrives with ignore === true and is
    // dropped, instead of overwriting the listings for the current ones.
    let ignore = false
    feedRequest.current += 1

    setLoading(true)
    setError(null)
    setLoadingMore(false)
    setMoreError(null)
    apiListListings({ q, category_id: active ?? undefined, location: locationFilter, limit: PAGE_SIZE })
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
  }, [active, q, locationFilter])

  // Changes one filter in the URL and keeps the others. null removes it.
  function setFilter(name: string, value: string | null) {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set(name, value)
    } else {
      next.delete(name)
    }
    setSearchParams(next)
  }

  function clearFilters() {
    setSearchParams({})
  }

  function handleLocationSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFilter('location', locationInput.trim() || null)
  }

  function loadMore() {
    // A second click before the first page arrives would ask for the same
    // offset again and add those listings twice.
    if (loadingMore) return

    // Remember which feed this page belongs to (see feedRequest above).
    const request = feedRequest.current

    setLoadingMore(true)
    setMoreError(null)
    apiListListings({ q, category_id: active ?? undefined, location: locationFilter, limit: PAGE_SIZE, offset: listings.length })
      .then((page) => {
        if (feedRequest.current !== request) return
        setListings((prev) => [...prev, ...page.items])
        setTotal(page.total)
      })
      .catch(() => {
        if (feedRequest.current !== request) return
        setMoreError('Não foi possível carregar mais anúncios. Tenta outra vez.')
      })
      .finally(() => {
        if (feedRequest.current !== request) return
        setLoadingMore(false)
      })
  }

  const activeCategory = categories.find((c) => c.id === active)

  return (
    <main>
      <section className="px-6 pt-11 pb-2">
        <h1 className="font-display font-bold tracking-tight text-[clamp(32px,6vw,52px)]">
          Não compres. <span className="text-accent">Troca.</span>
        </h1>
        <p className="text-muted text-lg mt-2 max-w-[46ch]">
          Dá aquilo que já não usas e recebe algo que precisas.<br/>
          <span className="text-brand font-semibold">Sem dinheiro: só toma-lá-dá-cá.</span>
        </p>
      </section>

      <nav className="chips" aria-label="Filtrar por categoria">
        {categories.map((cat) => (
          <button
            key={cat.id}
            className="chip"
            aria-pressed={active === cat.id}
            onClick={() => setFilter('category_id', active === cat.id ? null : String(cat.id))}
          >
            {categoryLabel(cat)}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2 px-6 pt-2">
        <form
          onSubmit={handleLocationSubmit}
          role="search"
          aria-label="Filtrar por localização"
          className="flex flex-1 gap-2 max-w-md"
        >
          <input
            type="search"
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            placeholder="Localização (ex.: Porto)"
            aria-label="Localização"
            maxLength={100}
            className="flex-1 px-4 py-2.5 bg-paper border border-line rounded-full text-ink placeholder:text-muted focus:border-brand focus:outline-none transition-colors"
          />
          <Button type="submit">Filtrar</Button>
        </form>

        {/* Outside the form on purpose: it clears every filter, not just the
            location, and must never trigger the location submit. */}
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-3 py-2 text-sm font-medium text-brand hover:underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      <section className="feed">
        {!loading && !error && (
          <p className="feed-count">
            {total} {total === 1 ? 'anúncio' : 'anúncios'}
            {activeCategory ? ` em ${categoryLabel(activeCategory)}` : ''}
            {q ? ` para "${q}"` : ''}
            {locationFilter ? ` · ${locationFilter}` : ''}
          </p>
        )}

        {/* Order matters: loading must come before the empty check, or the
            "nothing here" message would flash while the request is running. */}
        {error ? (
          <p className="empty" role="alert">{error}</p>
        ) : loading ? (
          <p className="empty" role="status">A carregar anúncios…</p>
        ) : listings.length === 0 ? (
          <p className="empty">
            {hasFilters
              ? 'Nenhum anúncio corresponde aos filtros.'
              : 'Ainda não há anúncios. Sê o primeiro a publicar!'}
          </p>
        ) : (
          <div className="grid">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}

        {!loading && !error && listings.length < total && (
          <div className="flex flex-col items-center gap-2 mt-8">
            <Button onClick={loadMore} loading={loadingMore}>
              {loadingMore ? 'A carregar…' : 'Carregar mais'}
            </Button>
            {moreError && <p role="alert" className="text-sm text-accent">{moreError}</p>}
          </div>
        )}
      </section>
    </main>
  )
}
