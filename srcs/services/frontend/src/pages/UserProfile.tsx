import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Avatar from '../components/Avatar'
import { buttonClasses } from '../components/Button'
import MessageCard from '../components/MessageCard'
import ListingCard, { EMPTY_STATE_CLASSES, LISTING_GRID_CLASSES } from '../components/ListingCard'
import { ApiError, apiGetPublicProfile, type ApiPublicProfile } from '../lib/api'

export default function UserProfile() {
  const { id } = useParams<{ id: string }>()
  const { user: currentUser } = useAuth()

  // The backend looks users up by numeric id only. Anything else
  // ("/users/rita") can never match, so it goes straight to "not found"
  // instead of asking the backend and showing its 422 as a generic error.
  const userId = Number(id)
  const validId = Number.isInteger(userId) && userId > 0

  const [profile, setProfile] = useState<ApiPublicProfile | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [notFound, setNotFound] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Hooks stay above the early returns below (Rules of Hooks).
  useEffect(() => {
    if (!validId) return

    // When the id in the URL changes before the previous response arrives,
    // that stale response is dropped.
    let ignore = false

    // Going from one profile straight to another keeps this page mounted:
    // drop the previous profile so it is never shown under the new URL.
    setProfile(null)
    setLoading(true)
    setNotFound(false)
    setError(null)
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
    }
  }, [userId, validId])

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

  // Check if the viewer is looking at their own profile
  const isOwnProfile = currentUser?.id === profile.id

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
              <p className="text-sm text-muted">Membro desde {memberSince}</p>
              {profile.user_location && (
                <p className="text-xs text-muted flex items-center gap-1 mt-1">
                  <span aria-hidden="true">📍</span>
                  <span>{profile.user_location}</span>
                </p>
              )}
            </div>
          </div>

          {isOwnProfile && (
            <div>
              <Link
                to="/profile"
                className={buttonClasses({ variant: 'primary', size: 'sm' })}
              >
                Editar o meu perfil
              </Link>
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
      <section className="space-y-4">
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
