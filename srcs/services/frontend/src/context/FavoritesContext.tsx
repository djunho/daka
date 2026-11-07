import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { ApiError, apiAddFavorite, apiGetFavorites, apiRemoveFavorite } from '../lib/api'
import { useAuth } from './AuthContext'

// Which listings the logged-in user saved as favorites. The backend does not
// say it on the listings themselves (cards have no such field, and the detail's
// is_favorited is always false), so this context reads the ids from
// GET /listings/favorites once per login. Every heart on screen (cards, the
// listing page, the favorites page) reads and changes this one set, so a
// change shows everywhere at once.

type FavoritesContextValue = {
  // False until the favorites of the logged-in user are known: a heart shown
  // before that could say "not saved" for a listing that is. Always true for
  // a visitor, who has no favorites to wait for.
  ready: boolean
  isFavorite: (listingId: number) => boolean
  // True while the request that adds or removes this listing is running.
  isPending: (listingId: number) => boolean
  // Changes the heart at once, then asks the backend. On failure the heart
  // goes back to how it was and the ApiError is thrown to the caller.
  toggleFavorite: (listingId: number) => Promise<void>
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

// The backend's MAX_LISTINGS_PAGE_SIZE: the fewest requests to read every id.
const FAVORITES_PAGE_SIZE = 100

// POST answers 409 both for a listing that is already a favorite and for the
// user's own listing. Only this detail tells them apart.
const ALREADY_FAVORITE_DETAIL = 'Listing is already in your favorites.'

type FavoritesState = {
  // The account these ids belong to. Compared with the current user, so the
  // previous account's favorites are never shown after a login change, not
  // even for the one render before the effect below clears them.
  userId: number | null
  ids: ReadonlySet<number>
}

async function fetchFavoriteIds(signal: AbortSignal): Promise<Set<number>> {
  const ids = new Set<number>()
  let offset = 0
  for (;;) {
    const page = await apiGetFavorites({ limit: FAVORITES_PAGE_SIZE, offset }, signal)
    page.items.forEach((listing) => ids.add(listing.id))
    offset += page.items.length
    // An empty page also stops: a favorite removed meanwhile in another tab
    // would otherwise leave offset below total forever.
    if (page.items.length === 0 || offset >= page.total) return ids
  }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [favorites, setFavorites] = useState<FavoritesState | null>(null)
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set())
  // Read by toggleFavorite, which must see the latest values even when two
  // clicks come before React renders again.
  const favoritesRef = useRef(favorites)
  favoritesRef.current = favorites
  const pendingRef = useRef(new Set<number>())
  // Bumped when the account changes: a request of the previous account that
  // ends afterwards must not touch the new account's hearts.
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    pendingRef.current = new Set()
    setPending(new Set())
    setFavorites(null)
    if (userId === null) return

    const controller = new AbortController()
    fetchFavoriteIds(controller.signal)
      .then((ids) => setFavorites({ userId, ids }))
      .catch(() => {
        // Aborted (logout or another account), or the server failed. Either
        // way the hearts stay hidden: showing them empty would be wrong.
      })
    return () => controller.abort()
  }, [userId])

  const ready = userId === null || favorites?.userId === userId

  const isFavorite = useCallback(
    (listingId: number) => favorites?.userId === userId && favorites.ids.has(listingId),
    [favorites, userId],
  )

  const isPending = useCallback((listingId: number) => pending.has(listingId), [pending])

  const toggleFavorite = useCallback(async (listingId: number) => {
    const current = favoritesRef.current
    // A second click while the first request runs would send the opposite
    // request before knowing whether the first one worked.
    if (current === null || pendingRef.current.has(listingId)) return

    const gen = generation.current
    const wasFavorite = current.ids.has(listingId)

    function setFavorite(on: boolean) {
      if (generation.current !== gen) return
      setFavorites((prev) => {
        if (prev === null) return prev
        const ids = new Set(prev.ids)
        if (on) {
          ids.add(listingId)
        } else {
          ids.delete(listingId)
        }
        return { ...prev, ids }
      })
    }

    function setBusy(busy: boolean) {
      if (generation.current !== gen) return
      if (busy) {
        pendingRef.current.add(listingId)
      } else {
        pendingRef.current.delete(listingId)
      }
      setPending(new Set(pendingRef.current))
    }

    setFavorite(!wasFavorite)
    setBusy(true)
    try {
      if (wasFavorite) {
        await apiRemoveFavorite(listingId)
      } else {
        await apiAddFavorite(listingId)
      }
    } catch (err) {
      // The backend already has what the user asked for (done in another
      // tab, for example): the heart on screen is right, nothing failed.
      const alreadyDone =
        err instanceof ApiError &&
        (wasFavorite
          ? err.status === 404
          : err.status === 409 && err.message === ALREADY_FAVORITE_DETAIL)
      if (!alreadyDone) {
        setFavorite(wasFavorite)
        throw err
      }
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <FavoritesContext.Provider value={{ ready, isFavorite, isPending, toggleFavorite }}>
      {children}
    </FavoritesContext.Provider>
  )
}

// Same rule as useAuth: outside the provider it fails loudly.
export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext)
  if (ctx === null) {
    throw new Error('useFavorites must be used inside <FavoritesProvider>')
  }
  return ctx
}
