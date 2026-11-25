import { useEffect, useRef, useState } from 'react'
import { useLocation, useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Avatar from '../components/Avatar'
import Icon from '../components/Icon'
import Button, { buttonClasses } from '../components/Button'
import MessageCard from '../components/MessageCard'
import OnlineBadge from '../components/OnlineBadge'
import ListingCard, { EMPTY_STATE_CLASSES, LISTING_GRID_CLASSES } from '../components/ListingCard'
import {
  ApiError,
  apiAddFriend,
  apiGetFriendStatus,
  apiGetPublicProfile,
  apiRemoveFriend,
  type ApiPublicProfile,
} from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'
import { useUserPresence } from '../hooks/useUserPresence'

export default function UserProfile() {
  const { id } = useParams<{ id: string }>()
  const { hash } = useLocation()
  const { user: currentUser, logout } = useAuth()

  // The backend looks users up by numeric id only. Anything else
  // ("/users/rita") can never match, so it goes straight to "not found"
  // instead of asking the backend and showing its 422 as a generic error.
  const userId = Number(id)
  const validId = Number.isInteger(userId) && userId > 0

  const [profile, setProfile] = useState<ApiPublicProfile | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [notFound, setNotFound] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Known before the profile arrives: the route requires a session, so the
  // current user is already loaded. Your own profile has no friend button.
  const isOwnProfile = currentUser?.id === userId

  // The profile says whether the user was online when it was read; this keeps
  // the badge following logins and logouts without reloading the page. Not
  // polled on your own profile: you are the one using it.
  const polledOnline = useUserPresence(validId && !isOwnProfile ? userId : null, { skipFirstPoll: true })

  // Friendship with the profile being viewed. null while it is being asked
  // for, so the button never guesses "Adicionar" or "Remover".
  const [isFriend, setIsFriend] = useState<boolean | null>(null)
  const [friendStatusFailed, setFriendStatusFailed] = useState<boolean>(false)
  const [friendBusy, setFriendBusy] = useState<boolean>(false)
  const [friendError, setFriendError] = useState<string | null>(null)

  // Bumped on every visit to a profile (and on leaving the page). The friend
  // requests can also start from a click, outside the effect below, so each
  // one remembers the visit it belongs to and drops its answer if the user
  // has moved to another profile meanwhile.
  const visit = useRef(0)
  // The friendship request in flight. A new one, or leaving the profile,
  // cancels it, so only the latest answer can reach the screen.
  const statusRequest = useRef<AbortController | null>(null)

  function cancelFriendStatus() {
    statusRequest.current?.abort()
    statusRequest.current = null
  }

  function loadFriendStatus() {
    cancelFriendStatus()
    const request = new AbortController()
    statusRequest.current = request
    setIsFriend(null)
    setFriendStatusFailed(false)
    apiGetFriendStatus(userId, request.signal)
      .then((data) => {
        if (request.signal.aborted) return
        setIsFriend(data.is_friend)
      })
      .catch((err) => {
        if (request.signal.aborted) return
        if (err instanceof ApiError && err.status === 401) {
          // The session expired. Clearing it lets RequireAuth send them to login.
          void logout()
        } else {
          // The profile itself still shows; only the button waits for a retry.
          setFriendStatusFailed(true)
        }
      })
  }

  async function toggleFriend() {
    const current = visit.current
    const adding = !isFriend
    setFriendBusy(true)
    setFriendError(null)
    try {
      if (adding) {
        await apiAddFriend(userId)
      } else {
        await apiRemoveFriend(userId)
      }
      if (visit.current !== current) return
      setIsFriend(adding)
    } catch (err) {
      if (visit.current !== current) return
      if (err instanceof ApiError && err.status === 401) {
        void logout()
      } else if (adding && err instanceof ApiError && err.status === 409) {
        // Already friends (added from another tab, or by the other user).
        setIsFriend(true)
      } else if (!adding && err instanceof ApiError && err.status === 404) {
        // No active friendship any more: the other user may have removed it.
        setIsFriend(false)
      } else if (adding && err instanceof ApiError && err.status === 404) {
        // The user deleted their account after the profile loaded.
        setNotFound(true)
      } else {
        setFriendError(getPortugueseErrorMessage(
          err,
          adding
            ? 'Não foi possível adicionar o amigo. Tenta outra vez.'
            : 'Não foi possível remover o amigo. Tenta outra vez.',
        ))
      }
    } finally {
      if (visit.current === current) setFriendBusy(false)
    }
  }

  // Hooks stay above the early returns below (Rules of Hooks).
  useEffect(() => {
    if (!validId) return

    visit.current += 1

    // When the id in the URL changes before the previous response arrives,
    // that stale response is dropped.
    let ignore = false

    // Going from one profile straight to another keeps this page mounted:
    // drop the previous profile so it is never shown under the new URL.
    setProfile(null)
    setLoading(true)
    setNotFound(false)
    setError(null)
    setFriendBusy(false)
    setFriendError(null)
    // Asked at the same time as the profile, not after it.
    if (isOwnProfile) {
      setIsFriend(null)
      setFriendStatusFailed(false)
    } else {
      loadFriendStatus()
    }
    apiGetPublicProfile(userId)
      .then((data) => {
        if (ignore) return
        setProfile(data)
      })
      .catch((err) => {
        if (ignore) return
        // 404 covers both a user that never existed and one that deleted
        // their account (soft delete).
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else if (err instanceof ApiError && err.status === 401) {
          void logout()
        } else {
          setError('Não foi possível carregar o perfil. Tenta outra vez.')
        }
      })
      .finally(() => {
        if (ignore) return
        setLoading(false)
      })

    return () => {
      ignore = true
      visit.current += 1
      cancelFriendStatus()
    }
    // loadFriendStatus, cancelFriendStatus and logout are left out on purpose:
    // the first two only read userId (listed), refs and setters, and the last just ends the
    // session, whichever render it comes from.
  }, [userId, validId, isOwnProfile])

  // "Ver anúncios" in the friends list links to /users/{id}#anuncios. The
  // router does not scroll to a hash, and the section only exists once the
  // profile is on screen, so scroll here. The profile and the end of loading
  // arrive in separate renders: both are needed, the same as the check that
  // decides between the skeleton and the page below.
  const profileReady = !loading && profile !== null && profile.id === userId
  useEffect(() => {
    if (profileReady && hash === '#anuncios') {
      document.getElementById('anuncios')?.scrollIntoView?.({ block: 'start' })
    }
  }, [profileReady, hash])

  if (!validId || notFound) {
    return (
      <MessageCard
        title="Utilizador não encontrado"
        text="O utilizador que procuras não existe ou foi removido."
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

  // `|| !profile` lets TypeScript know `profile` is set from here on.
  // The id check covers the first render after the URL changes, before the
  // effect above has run and cleared the previous profile.
  if (loading || !profile || profile.id !== userId) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Read by screen readers only; the skeleton below is just visual. */}
        <p role="status" className="sr-only">A carregar perfil…</p>
        {/* Skeleton: a grey outline of the profile card while it loads. */}
        <div
          className="bg-surface border border-line rounded-2xl p-6 shadow-sm animate-pulse"
          aria-hidden="true"
        >
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-paper shrink-0" />
            <div>
              <div className="h-6 w-40 rounded bg-paper" />
              <div className="h-4 w-28 rounded bg-paper mt-2" />
            </div>
          </div>
        </div>
      </main>
    )
  }

  // Format date: "janeiro de 2026"
  const memberSince = new Date(profile.created_at).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  })


  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Profile Card */}
      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-line">
          <div className="flex items-center gap-4">
            <Avatar avatar={profile.avatar} user_name={profile.user_name} />
            <div>
              <h1 className="font-display text-2xl font-bold text-ink">
                {profile.user_name}
              </h1>
              <OnlineBadge online={polledOnline ?? profile.is_online} showLabel className="mt-1" />
              <p className="text-sm text-muted">Membro desde {memberSince}</p>
              {profile.user_location && (
                <p className="text-xs text-muted flex items-center gap-1 mt-1">
                  <Icon name="location" size={12} />
                  <span>{profile.user_location}</span>
                </p>
              )}
            </div>
          </div>

          {isOwnProfile ? (
            <div>
              <Link
                to="/profile"
                className={buttonClasses({ variant: 'primary', size: 'sm' })}
              >
                Editar o meu perfil
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-start sm:items-end gap-1.5">
              {friendStatusFailed ? (
                <>
                  <p className="text-xs text-muted">Não foi possível verificar a amizade.</p>
                  <Button size="sm" onClick={loadFriendStatus}>
                    Tentar outra vez
                  </Button>
                </>
              ) : isFriend === null ? (
                <Button size="sm" loading>
                  A verificar amizade…
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={isFriend ? 'dangerOutline' : 'primary'}
                  loading={friendBusy}
                  onClick={toggleFriend}
                >
                  {isFriend ? 'Remover amigo' : 'Adicionar amigo'}
                </Button>
              )}
              {friendError && (
                <p role="alert" className="text-xs text-accent">{friendError}</p>
              )}
            </div>
          )}
        </div>

        {/* Public Info overview */}
        <div className="pt-6 grid grid-cols-2 gap-4">
          <div className="bg-paper/60 border border-line rounded-xl p-3.5">
            <span className="block text-xs font-medium text-muted mb-1">Localização</span>
            <span className="text-sm font-semibold text-ink">
              {profile.user_location || 'Não indicada'}
            </span>
          </div>
          <div className="bg-paper/60 border border-line rounded-xl p-3.5">
            <span className="block text-xs font-medium text-muted mb-1">Artigos para troca</span>
            <span className="text-sm font-semibold text-ink">
              {profile.listings.length} {profile.listings.length === 1 ? 'anúncio ativo' : 'anúncios ativos'}
            </span>
          </div>
        </div>
      </div>

      {/* Listings Section */}
      <section id="anuncios" className="space-y-4 scroll-mt-24">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-ink">
            Artigos de {profile.user_name}
          </h2>
          <span className="text-xs font-semibold bg-paper px-2.5 py-1 rounded-full text-muted border border-line">
            {profile.listings.length} {profile.listings.length === 1 ? 'anúncio' : 'anúncios'}
          </span>
        </div>

        {profile.listings.length === 0 ? (
          <div className={EMPTY_STATE_CLASSES}>
            <p>
              {isOwnProfile
                ? 'Ainda não tens anúncios ativos para troca.'
                : 'Este utilizador ainda não tem anúncios ativos para troca.'}
            </p>
          </div>
        ) : (
          <div className={LISTING_GRID_CLASSES}>
            {profile.listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      <div className="pt-2">
        <Link className={buttonClasses()} to="/">
          Voltar ao início
        </Link>
      </div>
    </main>
  )
}
