import type { Category, Listing } from '../types/listing'

// Photo placeholder background per category, until the user uploads a real photo.
const TINT: Record<Category, string> = {
  roupa:       '#e9d8c6',
  móveis:      '#d8e0da',
  cartas:      '#dcd6ec',
  livros:      '#e6d3d0',
  plantas:     '#cfe3d2',
  eletrónica:  '#d2dee8',
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const { title, wants, category, condition, location, owner } = listing

  return (
    <article className="card">
      <div className="card-media" style={{ ['--tint' as string]: TINT[category] }}>
        <span className="badge">{condition}</span>
        <span className="card-cat">{category}</span>
      </div>

      <div className="card-body">
        <h3 className="card-title">{title}</h3>

        <p className="swap">
          <span className="swap-arrow" aria-hidden="true">⇄</span>
          <span className="swap-label">quer:</span>
          <span className="swap-wants">{wants}</span>
        </p>

        <div className="card-meta">
          <span>{location}</span>
          <span className="dot" aria-hidden="true">•</span>
          <span>@{owner}</span>
        </div>
      </div>
    </article>
  )
}
