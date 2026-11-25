import { useState } from 'react'
import { type ApiCategory, type ApiImage } from '../lib/api'
import { categoryLabel, categoryTint } from '../types/listing'

type ListingGalleryProps = {
  images: ApiImage[]
  title: string
  category: ApiCategory
}

// Big photo on top, clickable thumbnails below. ListingDetail renders it with
// key={listing.id}, so the selected photo resets when another listing opens.
export default function ListingGallery({ images, title, category }: ListingGalleryProps) {
  const [selected, setSelected] = useState<number>(0)

  // No photos: a block in the category colour, like the cards on Home.
  if (images.length === 0) {
    return (
      <div
        className="aspect-[4/3] rounded-2xl border border-line bg-brand-soft flex items-end p-4"
        style={{ backgroundColor: categoryTint(category) }}
      >
        <span className="px-2.5 py-1 rounded-full bg-surface text-label text-xs font-bold uppercase tracking-wider">
          {categoryLabel(category)}
        </span>
      </div>
    )
  }

  // The API sends the photos in upload order; the primary one goes first.
  // sort() changes the array it is called on, hence the copy with [...images].
  const photos = [...images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
  // Fallback in case the list shrinks below the selected index.
  const current = photos[selected] ?? photos[0]

  return (
    <div>
      <img
        src={current.image_path}
        alt={photos.length > 1 ? `${title} (foto ${selected + 1} de ${photos.length})` : title}
        className="w-full aspect-[4/3] object-cover rounded-2xl border border-line"
      />

      {photos.length > 1 && (
        <ul className="flex gap-2 mt-3">
          {photos.map((photo, index) => (
            <li key={photo.id} className="flex-1 min-w-0 max-w-20">
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-label={`Ver foto ${index + 1} de ${photos.length}`}
                aria-current={index === selected ? 'true' : undefined}
                className={`block w-full aspect-square rounded-lg overflow-hidden border-2 ${
                  index === selected
                    ? 'border-brand'
                    : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                <img src={photo.image_path} alt="" className="w-full h-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
