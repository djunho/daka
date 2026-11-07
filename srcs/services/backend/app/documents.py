"""Saving, reading and deleting the PDF documents attached to listings.

Every PDF the app accepts goes through this module, so the rules live in one
place (the same idea as app/media.py for images):

  - it must be at most settings.max_document_bytes;
  - it must really be a PDF: the bytes start with "%PDF-" and pypdf can parse
    it. The file name and the Content-Type header are ignored because the
    client controls both;
  - it must open without a password (a PDF protected only against editing is
    accepted and saved without that protection);
  - it must have between 1 and settings.max_document_pages pages;
  - it must not contain active content: JavaScript, actions that run on open,
    launch actions, embedded files, multimedia, XFA forms or form submission;
  - it is rewritten before being stored, without its metadata (author,
    software, XMP), the same way images are re-encoded without EXIF.

Files are written under settings.documents_root, a volume nginx cannot see,
with a random name. The database keeps that name and the sanitised original
name, which is only shown to people and sent in Content-Disposition.

pypdf must stay >= 6.0.0: older versions do not limit how much a compressed
stream may expand (CVE-2025-55197), so a small file could exhaust the memory.
"""
import io
import re
import secrets
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject

from app.config import settings

PDF_MAGIC = b"%PDF-"

# Keys that make a PDF do something by itself when it is opened or clicked.
ACTIVE_CONTENT_KEYS = frozenset({
    "/JavaScript", "/JS", "/Launch", "/OpenAction", "/AA", "/EmbeddedFiles",
    "/RichMedia", "/XFA", "/SubmitForm", "/ImportData",
})

# Followed while looking for active content would only lead back up the page
# tree (/Parent) or into drawing instructions and fonts (/Contents,
# /Resources), which cannot hold any of the keys above.
SKIPPED_KEYS = frozenset({"/Parent", "/Contents", "/Resources"})

# How deep the search goes. Real catalogs are a few levels deep; the limit
# keeps a crafted file from making the walk endless.
MAX_WALK_DEPTH = 30

ORIGINAL_NAME_MAX = 150
DEFAULT_NAME = "documento.pdf"


@dataclass(frozen=True)
class SavedDocument:
    file_name: str
    original_name: str
    size_bytes: int
    page_count: int


def save_document(upload: UploadFile) -> SavedDocument:
    """Validate an uploaded PDF, store a clean copy and describe it."""
    # Read one byte past the limit: if that byte exists, the file is too big.
    data = upload.file.read(settings.max_document_bytes + 1)
    if len(data) > settings.max_document_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"The document is too large. The maximum size is "
            f"{settings.max_document_bytes // (1024 * 1024)} MB.",
        )
    if not data.startswith(PDF_MAGIC):
        raise _not_a_pdf()

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        # Only a PDF protected against editing opens with an empty password.
        needs_password = reader.is_encrypted and not reader.decrypt("")
    except Exception:
        # pypdf raises many types (PdfReadError, PdfStreamError, ValueError,
        # LimitReachedError...): for the user they all mean the same thing.
        raise _not_a_pdf()
    if needs_password:
        raise _rejected("The document must open without a password.")

    try:
        page_count = len(reader.pages)
        active = _find_active_content(reader.trailer["/Root"])
    except Exception:
        raise _not_a_pdf()
    if not 1 <= page_count <= settings.max_document_pages:
        raise _rejected(
            f"The document must have between 1 and {settings.max_document_pages} pages."
        )
    if active:
        raise _rejected(
            "The document must not contain JavaScript, attachments or other active content."
        )

    try:
        clean = _rewrite_without_metadata(reader)
    except Exception:
        raise _not_a_pdf()

    directory = Path(settings.documents_root)
    directory.mkdir(parents=True, exist_ok=True)
    # Random name: unguessable, never clashes, and nothing the client sent
    # ever reaches the file system.
    file_name = f"{secrets.token_hex(16)}.pdf"
    (directory / file_name).write_bytes(clean)

    return SavedDocument(
        file_name=file_name,
        original_name=sanitize_original_name(upload.filename),
        size_bytes=len(clean),
        page_count=page_count,
    )


def document_path(file_name: str) -> Path | None:
    """The stored file for this name, or None if it is missing or unsafe."""
    root = Path(settings.documents_root).resolve()
    path = (root / file_name).resolve()
    # Refuse anything that escapes documents_root and anything that is not a
    # regular file, such as a folder.
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path


def delete_document(file_name: str | None) -> None:
    """Delete a stored document. Safe to call with None or a missing file."""
    if not file_name:
        return
    path = document_path(file_name)
    if path is not None:
        path.unlink(missing_ok=True)


def sanitize_original_name(name: str | None) -> str:
    """The name shown to people: no folders, no control characters, ends in .pdf."""
    # Browsers on Windows may send the whole path ("C:\\Users\\...\\x.pdf").
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    # Control and format characters (CR, LF, NUL, right-to-left overrides...)
    # could break the header or disguise the extension.
    base = "".join(ch for ch in base if unicodedata.category(ch)[0] != "C")
    base = re.sub(r"\s+", " ", base).strip()
    # The extension is taken off before trimming dots, so ".pdf" alone is
    # an empty name, not "pdf".
    stem = base[:-4] if base.lower().endswith(".pdf") else base
    stem = stem.strip(" .")[: ORIGINAL_NAME_MAX - len(".pdf")].rstrip(" .")
    return f"{stem}.pdf" if stem else DEFAULT_NAME


def _find_active_content(root: object) -> str | None:
    """Walk the document's dictionaries and return the first active key found.

    Only dictionaries and arrays are visited: content streams are never
    decoded, so the walk stays cheap even for a large file.
    """
    seen: set[tuple[int, int]] = set()

    def walk(obj: object, depth: int) -> str | None:
        if depth > MAX_WALK_DEPTH:
            return None
        if isinstance(obj, IndirectObject):
            ref = (obj.idnum, obj.generation)
            if ref in seen:
                return None
            seen.add(ref)
            obj = obj.get_object()
        if isinstance(obj, DictionaryObject):
            for key, value in obj.items():
                if key in ACTIVE_CONTENT_KEYS:
                    return str(key)
                if key in SKIPPED_KEYS:
                    continue
                found = walk(value, depth + 1)
                if found:
                    return found
        elif isinstance(obj, ArrayObject):
            for value in obj:
                found = walk(value, depth + 1)
                if found:
                    return found
        return None

    return walk(root, 0)


def _rewrite_without_metadata(reader: PdfReader) -> bytes:
    """Write the document again without /Info and XMP metadata."""
    writer = PdfWriter(clone_from=reader)
    writer.metadata = None
    writer.root_object.pop("/Metadata", None)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _not_a_pdf() -> HTTPException:
    """The single 415 every "this is not a valid PDF" case raises."""
    return HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail="The file must be a valid PDF document.",
    )


def _rejected(detail: str) -> HTTPException:
    """A real PDF that breaks one of the content rules."""
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)
