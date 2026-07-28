import { useState } from 'react'
import Header from '../components/Header'
import ListingCard from '../components/ListingCard'
import { mockListings } from '../data/mockListings'
import { CATEGORIES, type Category } from '../types/listing'

export default function Home() {
  // Category filter — client-side state only, no backend.
  const [active, setActive] = useState<Category | null>(null)

  const listings = active
    ? mockListings.filter((l) => l.category === active)
    : mockListings

  return (
    <>
      <Header />

      <main>
        <section className="hero">
          <h1 className="hero-title">
            Não compres. <span className="swap-word">Troca.</span>
          </h1>
          <p className="hero-sub">
            Dá aquilo que já não usas e recebe algo que precisas. Sem dinheiro — só toma-lá-dá-cá.
          </p>
        </section>

        <nav className="chips" aria-label="Filtrar por categoria">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className="chip"
              aria-pressed={active === cat}
              onClick={() => setActive(active === cat ? null : cat)}
            >
              {cat}
            </button>
          ))}
        </nav>

        <section className="feed">
          <p className="feed-count">
            {listings.length} {listings.length === 1 ? 'anúncio' : 'anúncios'}
            {active ? ` em ${active}` : ''}
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
    </>
  )
}
