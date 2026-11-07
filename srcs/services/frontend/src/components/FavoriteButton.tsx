import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { useFavorites } from '../context/FavoritesContext'
import { ApiError } from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'
import Icon from './Icon'

// How long an error stays next to the heart. It sits over the photo of a card,
// so it should not stay there for good.
export const FAVORITE_ERROR_MS = 5_000

type FavoriteButtonProps = {
  listingId: number
  // The owner never sees the heart: the backend refuses to save your own listing.
  ownerId: number
  title: string
  // 'card': a round icon over the card's photo. 'detail': a button with text,
  // on the listing page.
  variant: 'card' | 'detail'
  // Where the caller places it, e.g. "absolute top-2.5 left-2.5". It must
  // set a position (relative by default): the error is placed against it.
  className?: string
}

export default function FavoriteButton({ listingId, ownerId, title, variant, className = 'relative' }: FavoriteButtonProps) {
  const { user, loading: authLoading, logout } = useAuth()
  const { ready, isFavorite, isPending, toggleFavorite } = useFavorites()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  // False once the button has left the page, e.g. the favorites page that
  // RequireAuth replaced with the login page when the session was cleared.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!error) return
    const id = window.setTimeout(() => setError(null), FAVORITE_ERROR_MS)
    return () => window.clearTimeout(id)
  }, [error])

  // Until the session and the favorites are known, the heart could show the
  // wrong state, or show on the user's own listing for a moment.
  if (authLoading || !ready || user?.id === ownerId) return null

  const saved = isFavorite(listingId)

  function goToLogin() {
    // The search part keeps the Home filters when the user comes back.
    navigate('/login', { state: { from: location.pathname + location.search } })
  }

  async function handleClick() {
    if (!user) {
      // Nothing is saved until they click again after signing in.
      goToLogin()
      return
    }
    setError(null)
    try {
      await toggleFavorite(listingId)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // The session expired after the page loaded. Clear it first, or the
        // login page would see a user and send them straight back here.
        await logout()
        // Gone with its page: whatever replaced it (RequireAuth's redirect,
        // or a page the user went to) decides where they are. Navigating
        // again would add a second /login to the history.
        if (!mounted.current) return
        goToLogin()
        return
      }
      setError(getPortugueseErrorMessage(
        err,
        saved
          ? 'Não foi possível remover dos favoritos. Tenta outra vez.'
          : 'Não foi possível guardar nos favoritos. Tenta outra vez.',
        { 404: 'Este anúncio já não está disponível.' },
      ))
    }
  }

  const heart = (
    <Icon
      name="heart"
      size={variant === 'card' ? 20 : 16}
      className={saved ? 'fill-current text-accent' : variant === 'card' ? 'text-ink' : 'text-current'}
    />
  )

  return (
    <div className={className}>
      {variant === 'card' ? (
        // Icon only: the name stays the same and aria-pressed says whether it
        // is saved, so a screen reader announces it as a toggle button.
        <button
          type="button"
          onClick={handleClick}
          aria-label={`Guardar nos favoritos: ${title}`}
          aria-pressed={saved}
          aria-busy={isPending(listingId)}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-surface/90 shadow-sm hover:bg-surface hover:scale-105 transition motion-reduce:transition-none"
        >
          {heart}
        </button>
      ) : (
        // The visible text changes with the state, so it is the name itself
        // that tells it (aria-pressed would say it twice).
        <button
          type="button"
          onClick={handleClick}
          aria-busy={isPending(listingId)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-surface text-ink border border-line hover:border-accent transition-colors"
        >
          {heart}
          {saved ? 'Guardado nos favoritos' : 'Guardar nos favoritos'}
        </button>
      )}
      {error && (
        <p
          role="alert"
          className={`absolute top-full mt-1.5 z-[1] w-max max-w-[220px] px-2.5 py-1.5 rounded-lg bg-surface border border-line shadow-md text-xs text-accent ${
            variant === 'card' ? 'left-0' : 'right-0'
          }`}
        >
          {error}
        </p>
      )}
    </div>
  )
}
