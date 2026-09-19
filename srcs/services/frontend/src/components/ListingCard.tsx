import { Link } from 'react-router-dom'
import { CATEGORY_BY_ID, type CategoryId, type Listing } from '../types/listing'

// Photo placeholder background per category, until the user uploads a real photo.
const TINT: Record<CategoryId, string> = {
  roupa:         '#e9d8c6',
  eletronica:    '#d2dee8',
  casa:          '#d8e0da',
  livros:        '#e6d3d0',
  plantas:       '#cfe3d2',
  colecionaveis: '#dcd6ec',
  outros:        '#e4e2dd',
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const { id, title, wants, category, condition, location, owner } = listing

  return (
    <Link to={`/listing/${id}`} className="card block text-inherit no-underline">
      <div className="card-media" style={{ ['--tint' as string]: TINT[category] }}>
        <span className="badge">{condition}</span>
        {/* show the human-facing label, not the code id */}
        <span className="card-cat">{CATEGORY_BY_ID[category].label}</span>
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
    </Link>
  )
}
