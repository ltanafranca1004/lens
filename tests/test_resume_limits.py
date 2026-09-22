"""Resume input limits (app/resume.py + the upload route): type by content not extension, the PDF
page cap, and the threaded parse timeout.

Run with:
    ./venv/bin/python -m unittest discover -s tests -v
"""
import io
import os
import time
import unittest
import zipfile
from types import SimpleNamespace
from unittest import mock

from docx import Document
from fastapi.testclient import TestClient
import pypdf
from pypdf import PdfReader, PdfWriter
from pypdf.errors import LimitReachedError
from pypdf.generic import DecodedStreamObject, NameObject

import main
from app import ratelimit, resume as resume_mod
from app.auth import get_current_user
from app.database import get_db
from app.resume import MAX_PDF_PAGES, ResumeParseError, extract_resume_text
from app.routers import sessions as sessions_router


def _pdf(pages: int) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _docx(text: str) -> bytes:
    doc = Document()
    doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _plain_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("notes.txt", "not a word document")
    return buf.getvalue()


class TypeByContent(unittest.TestCase):
    def test_docx_detected_regardless_of_name(self):
        self.assertEqual(extract_resume_text(_docx("Built a Kafka pipeline.")), "Built a Kafka pipeline.")

    def test_unknown_bytes_rejected(self):
        with self.assertRaisesRegex(ResumeParseError, "Unsupported file type"):
            extract_resume_text(b"just some text pretending to be a PDF")

    def test_zip_without_word_document_rejected(self):
        with self.assertRaisesRegex(ResumeParseError, "Unsupported file type"):
            extract_resume_text(_plain_zip())

    def test_pdf_magic_with_garbage_is_unreadable(self):
        with self.assertRaisesRegex(ResumeParseError, "Could not read the PDF"):
            extract_resume_text(b"%PDF-1.7 this is not really a pdf")


class PdfPageCap(unittest.TestCase):
    def test_over_cap_rejected(self):
        with self.assertRaisesRegex(ResumeParseError, f"at most {MAX_PDF_PAGES} pages"):
            extract_resume_text(_pdf(MAX_PDF_PAGES + 1))

    def test_at_cap_is_parsed(self):
        # Blank pages have no text, so this reaches (and fails at) the no-text check, not the cap.
        with self.assertRaisesRegex(ResumeParseError, "No text could be extracted"):
            extract_resume_text(_pdf(MAX_PDF_PAGES))


class PdfStreamLimits(unittest.TestCase):
    def test_limits_are_applied_during_pdf_parsing(self):
        seen = {}

        def capture(_data):
            seen["zlib"] = pypdf.get_configuration().zlib_maximum_output_length
            return "text"

        with mock.patch.object(resume_mod, "_extract_pdf_limited", capture):
            resume_mod._extract_pdf(b"%PDF-")
        self.assertEqual(seen["zlib"], resume_mod._PDF_STREAM_LIMIT)
        self.assertEqual(pypdf.get_configuration().zlib_maximum_output_length, 75_000_000)  # restored

    def test_oversized_stream_trips_the_limit(self):
        writer = PdfWriter()
        page = writer.add_blank_page(width=612, height=792)
        stream = DecodedStreamObject()
        stream.set_data(b" " * (resume_mod._PDF_STREAM_LIMIT + 1))  # compresses to a few KB
        page[NameObject("/Contents")] = writer._add_object(stream.flate_encode())
        buf = io.BytesIO()
        writer.write(buf)
        with pypdf.apply_configuration(**resume_mod._PDF_LIMITS), self.assertRaises(LimitReachedError):
            PdfReader(io.BytesIO(buf.getvalue())).pages[0].get_contents().get_data()


class UploadRoute(unittest.TestCase):
    def setUp(self):
        ratelimit.store.reset()
        db = mock.MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [
            SimpleNamespace(id=1, user_id=1, resume_text=None),  # the owned session
            None,  # no questions generated yet
        ]
        main.app.dependency_overrides[get_db] = lambda: db
        main.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        ratelimit.store.reset()

    def _upload(self, name: str, data: bytes):
        return self.client.post("/sessions/1/resume", files={"file": (name, data)})

    def test_docx_named_pdf_accepted(self):
        r = self._upload("resume.pdf", _docx("Shipped a React Native app."))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["resume_chars"], len("Shipped a React Native app."))

    def test_text_file_renamed_pdf_rejected(self):
        r = self._upload("resume.pdf", b"plain text, not a pdf")
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["detail"], "Unsupported file type. Upload a PDF or .docx resume.")

    def test_long_pdf_rejected(self):
        r = self._upload("resume.pdf", _pdf(MAX_PDF_PAGES + 1))
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["detail"], f"Resume PDFs can be at most {MAX_PDF_PAGES} pages.")

    def test_parse_timeout(self):
        def slow_parse(_data):
            time.sleep(1)
            return "never used"

        # A persistent client (context manager) keeps one event loop alive, as uvicorn does; a
        # per-request loop would join the still-running worker thread at teardown and skew timing.
        with mock.patch.dict(os.environ, {"RESUME_PARSE_TIMEOUT_SECONDS": "0.1"}), \
             mock.patch.object(sessions_router, "extract_resume_text", slow_parse), \
             TestClient(main.app) as client:
            started = time.monotonic()
            r = client.post("/sessions/1/resume", files={"file": ("resume.pdf", _pdf(1))})
            elapsed = time.monotonic() - started
        self.assertEqual(r.status_code, 422)
        self.assertEqual(
            r.json()["detail"], "Your resume took too long to process. Try a simpler PDF or a .docx."
        )
        self.assertLess(elapsed, 0.9)  # answered at the timeout, not after the parse finished


if __name__ == "__main__":
    unittest.main()
