import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import ListingCard, { EMPTY_STATE_CLASSES, LISTING_GRID_CLASSES } from '../components/ListingCard'
import LocationAutocomplete from '../components/LocationAutocomplete'
import { categoryLabel } from '../types/listing'
import { apiListCategories, type ApiCategory, apiListListings, type ApiListingSummary, type ListingSort } from '../lib/api'

const PAGE_SIZE = 12
const DEFAULT_SORT: ListingSort = 'newest'
const SORT_OPTIONS: { value: ListingSort; label: string }[] = [
  { value: 'newest', label: 'Mais recentes' },
  { value: 'oldest', label: 'Mais antigos' },
  { value: 'title_asc', label: 'Título (A–Z)' },
  { value: 'title_desc', label: 'Título (Z–A)' },
]

export default function Home() {
  // Filters live in the URL (/?q=...&category_id=...&location=...&sort=...), so they survive a reload and can be shared.
  const [searchParams, setSearchParams] = useSearchParams()
  // A URL typed or edited by hand can bring spaces or more text than the
  // backend accepts (q: 150, location: 200 characters, else 422). Cut in code
  // points, as the backend counts them.
  const q = [...(searchParams.get('q') ?? '').trim()].slice(0, 150).join('')
  const categoryId = Number(searchParams.get('category_id'))
  const active = Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null
  const locationFilter = [...(searchParams.get('location') ?? '').trim()].slice(0, 200).join('')
  const hasFilters = q !== '' || active !== null || locationFilter !== ''
  // An unknown value in a hand-edited URL would get a 422 from the backend.
  const sort = SORT_OPTIONS.find((o) => o.value === searchParams.get('sort'))?.value ?? DEFAULT_SORT

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
    apiListListings({ q, category_id: active ?? undefined, location: locationFilter, sort, limit: PAGE_SIZE })
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
  }, [active, q, locationFilter, sort])

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

  // The sort order is not a filter, so it stays.
  function clearFilters() {
    setSearchParams(sort === DEFAULT_SORT ? {} : { sort })
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
    apiListListings({ q, category_id: active ?? undefined, location: locationFilter, sort, limit: PAGE_SIZE, offset: listings.length })
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
      <section className="px-4 sm:px-6 pt-11 pb-2">
        <h1 className="font-display font-bold tracking-tight text-[clamp(32px,6vw,52px)]">
          Não compres. <span className="text-accent">Troca.</span>
        </h1>
        <p className="text-muted text-lg mt-2 max-w-[46ch]">
          Dá aquilo que já não usas e recebe algo que precisas.<br/>
          <span className="text-brand font-semibold">Sem dinheiro: só toma-lá-dá-cá.</span>
        </p>
      </section>

      <nav className="flex flex-wrap gap-2 px-4 sm:px-6 pt-5 pb-2" aria-label="Filtrar por categoria">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className="px-3.5 py-2 rounded-full border border-line bg-surface text-muted capitalize font-semibold text-sm transition-colors hover:border-brand aria-pressed:bg-brand-soft aria-pressed:border-brand-soft aria-pressed:text-brand"
            aria-pressed={active === cat.id}
            onClick={() => setFilter('category_id', active === cat.id ? null : String(cat.id))}
          >
            {categoryLabel(cat)}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 pt-2">
        <form
          onSubmit={handleLocationSubmit}
          role="search"
          aria-label="Filtrar por localização"
          className="flex w-full gap-2 sm:w-auto sm:flex-1 sm:max-w-md"
        >
          <LocationAutocomplete
            id="home-location"
            label="Localização"
            hideLabel
            value={locationInput}
            placeholder="Localização (ex.: Porto)"
            className="flex-1"
            inputClassName="rounded-full bg-paper"
            // Updates only the draft input while typing (no API call per keystroke).
            onChange={setLocationInput}
            // Applies the URL filter immediately when a dropdown suggestion is chosen.
            onSelect={(val) => setFilter('location', val.trim() || null)}
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

        <label className="flex items-center gap-2 ml-auto text-sm text-muted">
          Ordenar por
          <select
            value={sort}
            onChange={(e) => setFilter('sort', e.target.value === DEFAULT_SORT ? null : e.target.value)}
            className="px-3 py-2.5 bg-paper border border-line rounded-full text-base text-ink focus:border-brand transition-colors"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <section className="px-4 sm:px-6 pt-2 pb-12">
        {!loading && !error && (
          <p className="text-muted text-sm mt-2 mb-4">
            {total} {total === 1 ? 'anúncio' : 'anúncios'}
            {activeCategory ? ` em ${categoryLabel(activeCategory)}` : ''}
            {q ? ` para "${q}"` : ''}
            {locationFilter ? ` · ${locationFilter}` : ''}
          </p>
        )}

        {/* Order matters: loading must come before the empty check, or the
            "nothing here" message would flash while the request is running. */}
        {error ? (
          <p className={EMPTY_STATE_CLASSES} role="alert">{error}</p>
        ) : loading ? (
          <p className={EMPTY_STATE_CLASSES} role="status">A carregar anúncios…</p>
        ) : listings.length === 0 ? (
          <p className={EMPTY_STATE_CLASSES}>
            {hasFilters
              ? 'Nenhum anúncio corresponde aos filtros.'
              : 'Ainda não há anúncios. Sê o primeiro a publicar!'}
          </p>
        ) : (
          <div className={LISTING_GRID_CLASSES}>
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
