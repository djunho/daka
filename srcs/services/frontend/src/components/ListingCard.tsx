import { Link } from 'react-router-dom'
import { categoryLabel, categoryTint, conditionLabel } from '../types/listing'
import { type ApiListingSummary } from '../lib/api'

export default function ListingCard({ listing }: { listing: ApiListingSummary }) {
  const { id, title, wish, category, condition, listing_location, owner, cover_image } = listing

  return (
    <Link to={`/listing/${id}`} className="card block text-inherit no-underline">
      <div className="card-media" style={{ ['--tint' as string]: categoryTint(category) }}>
        {cover_image && (
          <img src={cover_image} alt={title} className='absolute inset-0 w-full h-full object-cover' loading='lazy' />
        )}
        <span className="badge">{conditionLabel(condition)}</span>
        {/* show the human-facing label, not the code id */}
        <span className="card-cat relative">{categoryLabel(category)}</span>
      </div>

      <div className="card-body">
        <h3 className="card-title">{title}</h3>

        {wish && (
          <p className="swap">
            <span className="swap-arrow" aria-hidden="true">⇄</span>
            <span className="swap-label">quer:</span>
            <span className="swap-wants">{wish}</span>
          </p>
        )}

        <div className="card-meta">
          {listing_location && (
            <>
              <span>{listing_location}</span>
              <span className="dot" aria-hidden="true">•</span>
            </>
          )}
          <span>@{owner.user_name}</span>
        </div>
      </div>
    </Link>
  )
}
