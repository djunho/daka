import { Link } from 'react-router-dom'
import { categoryLabel, categoryTint, conditionLabel } from '../types/listing'
import { type ApiListingSummary } from '../lib/api'

export const LISTING_GRID_CLASSES =
  'grid gap-5 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'

export const EMPTY_STATE_CLASSES =
  'p-12 text-center text-muted border border-dashed border-line rounded-[14px]'

export default function ListingCard({ listing }: { listing: ApiListingSummary }) {
  const { id, title, wish, category, condition, listing_location, owner, cover_image } = listing

  return (
    <Link
      to={`/listing/${id}`}
      className="block bg-surface border border-line rounded-[14px] overflow-hidden shadow-sm transition duration-150 ease-out hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transition-none text-inherit no-underline"
    >
      <div
        className="relative aspect-[4/3] bg-brand-soft flex items-end p-2.5"
        style={{ backgroundColor: categoryTint(category) }}
      >
        {cover_image && (
          <img src={cover_image} alt={title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        )}
        <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full bg-surface text-ink text-xs font-semibold">
          {conditionLabel(condition)}
        </span>
        {/* show the human-facing label, not the code id */}
        <span className="relative px-2.5 py-1 rounded-full bg-surface text-label text-xs font-bold uppercase tracking-wider">
          {categoryLabel(category)}
        </span>
      </div>

      <div className="px-4 pt-3.5 pb-4">
        <h3 className="font-bold text-base mb-2">{title}</h3>

        {wish && (
          <p className="flex items-baseline gap-1.5 text-sm">
            <span className="text-accent font-bold" aria-hidden="true">⇄</span>
            <span className="text-muted">quer:</span>
            <span className="text-accent font-semibold">{wish}</span>
          </p>
        )}

        <div className="flex gap-2 mt-3 pt-3 border-t border-line text-muted text-[13px]">
          {listing_location && (
            <>
              <span>{listing_location}</span>
              <span className="text-line" aria-hidden="true">•</span>
            </>
          )}
          <span>@{owner.user_name}</span>
        </div>
      </div>
    </Link>
  )
}
