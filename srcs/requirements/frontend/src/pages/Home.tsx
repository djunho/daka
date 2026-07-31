import { useState } from 'react'
import ListingCard from '../components/ListingCard'
import { mockListings } from '../data/mockListings'
import { CATEGORIES, CATEGORY_BY_ID, type CategoryId } from '../types/listing'

export default function Home() {
  // Category filter — we store the category id, client-side only, no backend.
  const [active, setActive] = useState<CategoryId | null>(null)

  const listings = active
    ? mockListings.filter((l) => l.category === active)
    : mockListings

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
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className="chip"
            aria-pressed={active === cat.id}
            onClick={() => setActive(active === cat.id ? null : cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </nav>

      <section className="feed">
        <p className="feed-count">
          {listings.length} {listings.length === 1 ? 'anúncio' : 'anúncios'}
          {active ? ` em ${CATEGORY_BY_ID[active].label}` : ''}
        </p>

        {listings.length === 0 ? (
          <p className="empty">Ainda não há nada nesta categoria. Sê o primeiro a publicar!</p>
        ) : (
          <div className="grid">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
