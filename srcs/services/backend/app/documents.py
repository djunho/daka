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
  - it must not contain active content: JavaScript, actions that run on open
    or on click (launch a program, submit a form, open another file...),
    embedded files, multimedia or XFA forms. Every reachable dictionary is
    checked, however deep; a file too big to check completely is rejected;
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
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, NameObject

from app.config import settings

PDF_MAGIC = b"%PDF-"

# Keys that make a PDF do something by itself when it is opened or clicked,
# or that carry content a viewer may run or extract.
ACTIVE_CONTENT_KEYS = frozenset({
    "/JavaScript", "/JS", "/OpenAction", "/AA", "/EmbeddedFiles",
    "/RichMediaContent", "/XFA",
})

# An action is a dictionary such as << /S /Launch /F (cmd.exe) >>: its type is
# the VALUE of /S, not a key, so it is checked separately. Plain links
# (/URI) and moves inside the document (/GoTo, /Named) stay allowed.
ACTIVE_ACTION_TYPES = frozenset({
    "/JavaScript", "/Launch", "/SubmitForm", "/ImportData", "/GoToR", "/GoToE",
    "/Rendition", "/Sound", "/Movie", "/RichMediaExecute",
})

# Annotations that embed a file or play media (their /Subtype value).
ACTIVE_ANNOTATION_SUBTYPES = frozenset({
    "/FileAttachment", "/RichMedia", "/Screen", "/Sound", "/Movie", "/3D",
})

# Followed while looking for active content would only lead back up the page
# tree (/Parent) or into drawing instructions and fonts (/Contents,
# /Resources), which cannot hold any of the above.
SKIPPED_KEYS = frozenset({"/Parent", "/Contents", "/Resources"})

# How many dictionaries and arrays the check may visit. There is no depth
# limit: bookmarks are a linked list (/Next), so a manual with 60 bookmarks is
# already 60 levels deep. A count limit still stops a crafted file from making
# the check endless, and going over it REJECTS the file (fail-closed): an
# active key past the limit would otherwise go unseen.
MAX_WALK_NODES = 200_000

# What _find_active_content returns when it had to stop before the end.
TOO_COMPLEX = "too complex"

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
    if active == TOO_COMPLEX:
        raise _rejected("The document is too complex to be checked.")
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
    """Return why the document has active content, or None if it has none.

    Walks every dictionary and array reachable from the catalog with an
    explicit stack (no recursion, so no depth limit), visiting each indirect
    object once. Content streams are never decoded, so the walk stays cheap.
    Returns TOO_COMPLEX when the document has more than MAX_WALK_NODES
    containers: the caller rejects it rather than accept what it did not see.
    """
    seen: set[tuple[int, int]] = set()
    stack: list[object] = [root]
    visited = 0

    while stack:
        obj = stack.pop()
        if isinstance(obj, IndirectObject):
            ref = (obj.idnum, obj.generation)
            if ref in seen:
                continue
            seen.add(ref)
            obj = obj.get_object()

        if isinstance(obj, DictionaryObject):
            visited += 1
            if visited > MAX_WALK_NODES:
                return TOO_COMPLEX
            for key, value in obj.items():
                if key in ACTIVE_CONTENT_KEYS:
                    return str(key)
                if key == "/S" and _name(value) in ACTIVE_ACTION_TYPES:
                    return f"/S {_name(value)}"
                if key == "/Subtype" and _name(value) in ACTIVE_ANNOTATION_SUBTYPES:
                    return f"/Subtype {_name(value)}"
                if key not in SKIPPED_KEYS:
                    stack.append(value)
        elif isinstance(obj, ArrayObject):
            visited += 1
            if visited > MAX_WALK_NODES:
                return TOO_COMPLEX
            stack.extend(obj)

    return None


def _name(value: object) -> str | None:
    """The name a value holds, following one indirect reference if needed."""
    if isinstance(value, IndirectObject):
        value = value.get_object()
    return str(value) if isinstance(value, NameObject) else None


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
