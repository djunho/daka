# File Uploads (images and PDF documents)

How Daka accepts, checks, stores, shows and deletes the files users upload. This covers the **Minor module "File upload and management system"** of the subject.

| Subject requirement | How Daka does it |
| --- | --- |
| Multiple file types | Images (JPEG, PNG, WebP) for avatars and listing photos; **PDF documents** attached to listings (manual, invoice, warranty) |
| Client- and server-side validation (type, size, format) | Both sides check type and size; the server also decodes the file, see below |
| Secure storage with access control | Random file names outside the repository; only the owner adds or deletes; PDFs live in a private volume and need a session |
| Preview | Images before upload (`useObjectUrl`); PDFs before upload (new tab, `blob:` URL) and after (browser PDF viewer) |
| Progress indicators | `UploadProgress` bar with the real percentage for every upload |
| Delete | Avatar, each photo and each document, with a confirmation dialog for photos and documents |

---

## Types and limits

| | Images | PDF documents |
| --- | --- | --- |
| Where | Avatar (1), listing photos (up to 6) | Listing documents (up to 3) |
| Formats | JPEG, PNG, WebP | PDF |
| Size | 2 MB each | 2 MB each |
| Other rules | ≤ 40 megapixels | 1–50 pages, opens without a password, no active content |
| Stored as | WebP, re-encoded, without EXIF | PDF, rewritten, without metadata |
| Served by | nginx, `/media/…` (public) | backend, `GET /api/listings/{id}/documents/{doc_id}/file` (**session required**) |

2 MB stays below nginx's `client_max_body_size 3m` on `/api/`, so the backend's check, with its clear message, is always the one that answers.

---

## Validation

**Client** (instant feedback, never trusted):

- `lib/images.ts` → `validateImage`: MIME type and size.
- `lib/documents.ts` → `validateDocument`: type `application/pdf` (or an empty type with a `.pdf` name), size, and the first bytes must be `%PDF-`.

**Server** (the real protection, the file name and `Content-Type` sent by the client are ignored):

- `app/media.py` → `save_image`: Pillow opens the file, checks the format and the pixel count before decoding, decodes it, applies the EXIF rotation and re-encodes it as WebP. Re-encoding drops all metadata (including GPS) and neutralises files that only pretend to be images.
- `app/documents.py` → `save_document`:
  1. size ≤ 2 MB → otherwise **413**;
  2. starts with `%PDF-` and pypdf parses it → otherwise **415**;
  3. encrypted: accepted only if it opens with an empty password (protection against editing only) → otherwise **422**;
  4. 1 ≤ pages ≤ 50 → otherwise **422**;
  5. no `/JavaScript`, `/JS`, `/Launch`, `/OpenAction`, `/AA`, `/EmbeddedFiles`, `/RichMedia`, `/XFA`, `/SubmitForm`, `/ImportData` anywhere in the document's dictionaries → otherwise **422**. Content streams are never decoded;
  6. rewritten with `PdfWriter(clone_from=…)` without `/Info` and XMP metadata, and without the editing protection.

`pypdf` is pinned to **6.21.4** and must stay **≥ 6.0.0**: older versions do not limit how much a compressed stream expands (CVE-2025-55197), so a small file could exhaust the memory.

---

## Storage and access control

- Files get a random name (`secrets.token_hex(16)`): unguessable, and nothing the client sent ever reaches the file system. Deleting checks that the path stays inside its folder.
- **Images**: volume `media`, mounted in the backend (read-write) and in nginx (read-only), served under `/media/` with `X-Content-Type-Options: nosniff`. Public on purpose: listing photos are the shop window of a listing.
- **Documents**: volume `documents`, mounted **only in the backend**, so nginx cannot serve them. `GET …/file` requires a session (401 without one) and answers 404 for a listing that is not available, unless the request comes from its owner. It is sent with `Content-Disposition: inline; filename="<original name>"`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. The original name is sanitised (no folders, no control characters, ends in `.pdf`).
- Only a listing's owner can add or delete its photos and documents (403 otherwise).
- Removing a listing deletes its documents (rows and files). Deleting an account deletes the avatar and the documents of all its listings, as the privacy policy promises.

---

## Progress

`uploadWithProgress` (`lib/api.ts`) sends each file with `XMLHttpRequest`, because `fetch` cannot report upload progress, and answers exactly like `request()` (same `/api` prefix, cookie, `ApiError`, `AbortError`). `UploadProgress` shows the percentage and, at 100%, "A processar…" while the server validates and stores the file.

On a local machine a 2 MB upload is almost instant. To **show the bar**, open DevTools → Network → throttling "Slow 4G" (or a custom profile) before publishing.

---

## Database

Table `documents` (`id`, `listing_id`, `file_name`, `original_name`, `size_bytes`, `page_count`, `created_at`), see `srcs/services/mariadb/schema.sql` and `dakaERD.md`. **Existing volumes** must apply `srcs/services/mariadb/tools/130-listing-documents.sql` before running this backend (instructions in `srcs/services/mariadb/README.md`).

---

## Demo

1. Publish a listing with two photos and one PDF, with "Slow 4G" on: the bar fills, says "A processar…" and the listing opens.
2. On the listing, logged in: "Abrir" opens the PDF in the browser viewer, "Descarregar" saves it with its original name.
3. Log out: the same listing shows the document, but only "Inicia sessão para abrir". Opening `…/file` directly answers 401.
4. Edit the listing: add a PDF that needs a password, or a `.txt` renamed to `.pdf`, and see the message; delete a document (dialog).
