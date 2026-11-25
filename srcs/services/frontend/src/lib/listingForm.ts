import type { ApiListingDetail, CreateListingData, UpdateListingData } from './api'

// The fields shared by the publish and edit forms. The keys are the backend's
// (ListingCreateIn / ListingUpdateIn), so values, errors and the request body
// all use the same names.
export type ListingFormValues = {
  title: string
  category_id: number | ''
  condition_id: number | ''
  listing_location: string
  wish: string
  listing_dsc: string
}

// Maximum number of photos per listing, mirroring backend MAX_IMAGES_PER_LISTING.
export const MAX_LISTING_PHOTOS = 6

// Type-safe container for field-level validation messages.
export type ListingFormErrors = Partial<Record<keyof ListingFormValues, string>>

export const EMPTY_LISTING_FORM: ListingFormValues = {
  title: '',
  category_id: '',
  condition_id: '',
  listing_location: '',
  wish: '',
  listing_dsc: '',
}

// The form filled with a listing's current data, for the edit page.
export function listingToFormValues(listing: ApiListingDetail): ListingFormValues {
  return {
    title: listing.title,
    category_id: listing.category.id,
    condition_id: listing.condition.id,
    listing_location: listing.listing_location ?? '',
    wish: listing.wish ?? '',
    listing_dsc: listing.listing_dsc ?? '',
  }
}

// The errors left after the user changes some fields: those fields' errors go.
export function clearFieldErrors(
  errors: ListingFormErrors,
  changes: Partial<ListingFormValues>,
): ListingFormErrors {
  const next = { ...errors }
  for (const name of Object.keys(changes) as Array<keyof ListingFormValues>) {
    delete next[name]
  }
  return next
}

// The id of each field's input, so the first invalid one can get the focus.
const FIELD_INPUT_IDS: Record<keyof ListingFormValues, string> = {
  title: 'title',
  category_id: 'category',
  condition_id: 'condition',
  listing_location: 'listing_location',
  wish: 'wish',
  listing_dsc: 'description',
}

// Client-side validation mirroring the backend schema. Lengths count code
// points ([...str].length), like Python's len(), so an emoji counts as one.
export function validateListingForm(values: ListingFormValues): ListingFormErrors {
  const errors: ListingFormErrors = {}
  const trimmedTitle = values.title.trim()
  const titleLength = [...trimmedTitle].length

  if (!trimmedTitle) {
    errors.title = 'O título do anúncio é obrigatório.'
  } else if (titleLength < 3) {
    errors.title = 'O título deve ter pelo menos 3 caracteres visíveis.'
  } else if (titleLength > 150) {
    errors.title = 'O título não pode ter mais de 150 caracteres.'
  }

  if (!values.category_id) {
    errors.category_id = 'Seleciona uma categoria.'
  }

  if (!values.condition_id) {
    errors.condition_id = 'Seleciona o estado do artigo.'
  }

  if ([...values.listing_location.trim()].length > 200) {
    errors.listing_location = 'A localização não pode ter mais de 200 caracteres.'
  }

  if ([...values.wish.trim()].length > 1000) {
    errors.wish = 'O que procuras em troca não pode ter mais de 1000 caracteres.'
  }

  if ([...values.listing_dsc.trim()].length > 2000) {
    errors.listing_dsc = 'A descrição não pode ter mais de 2000 caracteres.'
  }

  return errors
}

// Moves the focus to the first field with an error. Returns false when there
// is none, so callers can write `if (focusFirstError(errors)) return`.
export function focusFirstError(errors: ListingFormErrors): boolean {
  const firstErrorField = (Object.keys(errors) as Array<keyof ListingFormValues>)[0]
  if (!firstErrorField) return false
  document.getElementById(FIELD_INPUT_IDS[firstErrorField])?.focus()
  return true
}

// The request body: trimmed text, and null for an optional field left empty.
export function toListingPayload(values: ListingFormValues): CreateListingData {
  return {
    title: values.title.trim(),
    category_id: Number(values.category_id),
    condition_id: Number(values.condition_id),
    listing_location: values.listing_location.trim() || null,
    wish: values.wish.trim() || null,
    listing_dsc: values.listing_dsc.trim() || null,
  }
}

// Only the fields whose value changed, for PATCH /listings/{id}. It compares
// the cleaned values (trimmed, null when empty), so adding a space at the end
// of a field does not count as a change.
export function changedListingFields(
  before: ListingFormValues,
  after: ListingFormValues,
): UpdateListingData {
  const old = toListingPayload(before)
  const next = toListingPayload(after)
  return Object.fromEntries(
    (Object.keys(next) as Array<keyof CreateListingData>)
      .filter((name) => next[name] !== old[name])
      .map((name) => [name, next[name]]),
  )
}
