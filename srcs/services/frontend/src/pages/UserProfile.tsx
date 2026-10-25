import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Avatar from '../components/Avatar'
import ListingCard from '../components/ListingCard'
import { mockUsers } from '../data/mockUsers'
import { mockListings } from '../data/mockListings'
import type { ApiCategory, ApiCondition, ApiListingSummary } from '../lib/api'
import type { CategoryId, Condition, Listing } from '../types/listing'
import type { PublicUser } from '../types/user'

// TEMPORARY until #93: the mocks use the old listing shape, while ListingCard
// now takes the API shape. Delete this block when the page uses GET /users/{id}.
// Ids and English names are the ones in mariadb/seeds.sql.
const MOCK_CATEGORY: Record<CategoryId, ApiCategory> = {
  roupa: { id: 2, category_name: 'Clothing' },
  eletronica: { id: 5, category_name: 'Electronics' },
  casa: { id: 7, category_name: 'Home' },
  livros: { id: 1, category_name: 'Books' },
  plantas: { id: 9, category_name: 'Other' },
  colecionaveis: { id: 3, category_name: 'Collectibles' },
  outros: { id: 9, category_name: 'Other' },
}

const MOCK_CONDITION: Record<Condition, ApiCondition> = {
  'novo': { id: 1, condition_name: 'New' },
  'como novo': { id: 2, condition_name: 'Like New' },
  'usado': { id: 4, condition_name: 'Fair' },
  'com marcas': { id: 4, condition_name: 'Fair' },
}

function toApiListing(listing: Listing, owner: PublicUser): ApiListingSummary {
  return {
    id: Number(listing.id),
    title: listing.title,
    category: MOCK_CATEGORY[listing.category],
    condition: MOCK_CONDITION[listing.condition],
    listing_location: listing.location,
    wish: listing.wants,
    owner,
    cover_image: null,
    created_at: '',
  }
}

export default function UserProfile() {
  const { id } = useParams<{ id: string }>()
  const { user: currentUser } = useAuth()

  // Find user by ID or by username in mock data
  // This will allow to use the URL with either the numeric ID or the username, e.g. /users/1 or /users/djunho
  const profileUser = mockUsers.find(
    (u) => String(u.id) === id || u.user_name.toLowerCase() === id?.toLowerCase(),
  )

  // Memoize filtered listings and declare hook before early return (Rules of Hooks).
  // TODO(#93): Replace the mocks with GET /api/users/{id}, which returns the
  // user and their available listings already in the API shape.
  const userListings = useMemo(() => {
    if (!profileUser) return []
    return mockListings
      .filter((listing) => listing.owner.toLowerCase() === profileUser.user_name.toLowerCase())
      .map((listing) => toApiListing(listing, profileUser))
  }, [profileUser])

  if (!profileUser) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-surface border border-line rounded-2xl p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl font-bold text-ink mb-2">
            Utilizador não encontrado
          </h1>
          <p className="text-sm text-muted mb-6">
            O utilizador que procuras não existe ou foi removido.
          </p>
          <Link className="btn" to="/">
            Voltar ao início
          </Link>
        </div>
      </main>
    )
  }

  // Check if the viewer is looking at their own profile
  const isOwnProfile =
    currentUser &&
    (currentUser.id === profileUser.id ||
      currentUser.user_name.toLowerCase() === profileUser.user_name.toLowerCase())

  // Format date: "janeiro de 2026"
  const memberSince = new Date(profileUser.created_at).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  })


  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Profile Card */}
      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-line">
          <div className="flex items-center gap-4">
            <Avatar avatar={profileUser.avatar} user_name={profileUser.user_name} />
            <div>
              <h1 className="font-display text-2xl font-bold text-ink">
                {profileUser.user_name}
              </h1>
              <p className="text-sm text-muted">Membro desde {memberSince}</p>
              {profileUser.user_location && (
                <p className="text-xs text-muted flex items-center gap-1 mt-1">
                  <span aria-hidden="true">📍</span>
                  <span>{profileUser.user_location}</span>
                </p>
              )}
            </div>
          </div>

          {isOwnProfile && (
            <div>
              <Link
                to="/profile"
                className="text-xs font-semibold bg-brand text-surface px-3 py-2 rounded-lg hover:opacity-95 transition-opacity inline-flex items-center gap-1.5"
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
              {profileUser.user_location || 'Não indicada'}
            </span>
          </div>
          <div className="bg-paper/60 border border-line rounded-xl p-3.5">
            <span className="block text-xs font-medium text-muted mb-1">Artigos para troca</span>
            <span className="text-sm font-semibold text-ink">
              {userListings.length} {userListings.length === 1 ? 'anúncio ativo' : 'anúncios ativos'}
            </span>
          </div>
        </div>
      </div>

      {/* Listings Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-ink">
            Artigos de {profileUser.user_name}
          </h2>
          <span className="text-xs font-semibold bg-paper px-2.5 py-1 rounded-full text-muted border border-line">
            {userListings.length} {userListings.length === 1 ? 'anúncio' : 'anúncios'}
          </span>
        </div>

        {userListings.length === 0 ? (
          <div className="empty">
            <p>Este utilizador ainda não tem anúncios ativos para troca.</p>
          </div>
        ) : (
          <div className="grid">
            {userListings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      <div className="pt-2">
        <Link className="btn" to="/">
          Voltar ao início
        </Link>
      </div>
    </main>
  )
}
