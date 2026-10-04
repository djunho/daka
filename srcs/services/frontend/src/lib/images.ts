// Rules for images users upload: avatars now, listing photos later.
//
// They mirror the backend (app/media.py and settings.max_image_bytes).
// Checking here gives instant feedback before anything is sent; the backend
// check is still the one that protects us, because a client can always be
// bypassed.

// The formats the backend accepts. The browser fills File.type from the file
// name, which is good enough for a first, friendly check.
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Value for <input type="file" accept="...">: the file picker only offers
// these formats. The user can still pick another one, hence validateImage.
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')

// 2 MB, the same limit as the backend.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

// Returns the message to show the user, or null when the file looks fine.
export function validateImage(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'A imagem tem de ser JPEG, PNG ou WebP.'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'A imagem não pode ter mais de 2 MB.'
  }
  return null
}
