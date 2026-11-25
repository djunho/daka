"""Saving and deleting user-uploaded images.

Every image the app accepts -- avatars now, listing photos later -- goes
through this module, so the rules live in one place:

  - the file must really be a JPEG, PNG or WebP. Pillow decodes it to check;
    the file name and the Content-Type header are ignored because the client
    controls both;
  - it must be at most settings.max_image_bytes;
  - it is re-encoded as WebP before being written. Re-encoding drops every
    piece of metadata (EXIF), including the GPS position phones embed in
    photos, and neutralises files that only pretend to be images.

Files are written under settings.media_root/<folder>/ with a random name and
nginx serves them under settings.media_url. The database only stores the
public URL, e.g. "/media/avatars/3f2a....webp".
"""
import io
import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings

# Pillow's names for the formats we accept, as reported by Image.format.
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

# Upper bound on width * height, checked BEFORE decoding. A tiny PNG of a
# single colour can claim to be 30000x30000 pixels and need gigabytes of
# memory once decoded (a "decompression bomb"). 40 megapixels is more than any
# real phone photo.
MAX_PIXELS = 40_000_000


def save_image(upload: UploadFile, folder: str, max_side: int) -> str:
    """Validate an uploaded image, store it as WebP and return its public URL.

    ``folder`` groups files by purpose ("avatars", later "listings").
    ``max_side`` is the longest edge, in pixels, the stored image may have;
    bigger images are scaled down keeping their proportions.
    """
    # Read one byte past the limit: if that byte exists, the file is too big.
    # This never loads more than the limit into memory just to measure it.
    data = upload.file.read(settings.max_image_bytes + 1)
    if len(data) > settings.max_image_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image is too large. The maximum size is "
            f"{settings.max_image_bytes // (1024 * 1024)} MB.",
        )

    # Image.open only reads the header, so format and size are known before
    # any pixel is decoded.
    try:
        image = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, Image.DecompressionBombError):
        # Pillow itself refuses images over ~180 megapixels at open time.
        raise _not_an_image()
    if image.format not in ALLOWED_FORMATS:
        raise _not_an_image()
    if image.width * image.height > MAX_PIXELS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Image dimensions are too large.",
        )
    # Now decode for real: fails on truncated or corrupt files.
    try:
        image.load()
    except (OSError, Image.DecompressionBombError):
        raise _not_an_image()

    # Phones often store photos sideways plus an EXIF "rotate me" flag. That
    # flag is lost with the rest of the metadata, so apply it first or the
    # picture would show up rotated.
    image = ImageOps.exif_transpose(image)
    # WebP stores RGB or RGBA. Palette, greyscale and CMYK images are
    # converted, keeping transparency when the original had any.
    has_alpha = image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
    image = image.convert("RGBA" if has_alpha else "RGB")
    # Scale down in place, keeping proportions. Never scales up.
    image.thumbnail((max_side, max_side))

    directory = Path(settings.media_root) / folder
    directory.mkdir(parents=True, exist_ok=True)
    # Random name: unguessable, never clashes, and nothing the client sent
    # (like its original file name) ever reaches the file system.
    filename = f"{secrets.token_hex(16)}.webp"
    image.save(directory / filename, format="WEBP", quality=85)

    return f"{settings.media_url}/{folder}/{filename}"


def delete_image(url: str | None) -> None:
    """Delete a file previously returned by save_image.

    Safe to call with anything: None and URLs we did not create (such as a
    Google profile picture) are ignored, and so is a file that is already gone.
    """
    prefix = f"{settings.media_url}/"
    if not url or not url.startswith(prefix):
        return

    root = Path(settings.media_root).resolve()
    path = (root / url.removeprefix(prefix)).resolve()
    # Refuse anything that escapes media_root (e.g. "/media/../../app/main.py")
    # and anything that is not a regular file, such as a folder.
    if not path.is_relative_to(root) or not path.is_file():
        return
    path.unlink(missing_ok=True)


def _not_an_image() -> HTTPException:
    """The single 415 every "this is not an accepted image" case raises."""
    return HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail="The file must be a JPEG, PNG or WebP image.",
    )
