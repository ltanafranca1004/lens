"""Resume file parsing: PDF/DOCX bytes -> plain text, for blended question generation.

Provider-free (no external API, consistent with the project's zero-new-cost discipline): PDFs via
pypdf, .docx via python-docx. Text only -- the uploaded file itself is never stored. Kept as a thin
seam so Phase 2 (verifying an answer's claims against the resume) can read the same stored text.
"""
import io
import zipfile

from docx import Document
from pypdf import PdfReader

# Cap the accepted upload and the stored text. MAX_RESUME_CHARS keeps job posting + resume within one
# Groq request's token budget (free tier: 8,000 tokens/minute), alongside schemas.SessionCreate's cap.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_RESUME_CHARS = 8_000
MAX_PDF_PAGES = 5
# A DOCX is a ZIP; a small upload can declare a huge uncompressed payload (a decompression bomb).
# A real resume expands to well under this, so cap the total declared uncompressed size and reject
# before python-docx decompresses any member. Generous enough for resumes with embedded images.
MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024  # 50 MB

# File type is decided by content, never by the client-supplied filename.
_PDF_MAGIC = b"%PDF-"
_ZIP_MAGIC = b"PK\x03\x04"
_DOCX_MAIN_PART = "word/document.xml"
_UNSUPPORTED = "Unsupported file type. Upload a PDF or .docx resume."


class ResumeParseError(Exception):
    """Raised when an upload can't be turned into usable resume text (unsupported type, a corrupt
    file, or no extractable text). The route maps this to a 4xx response with the message."""


def _normalize(text: str) -> str:
    """Collapse runs of whitespace/newlines, trim, then cap length -- keeps stored text compact and
    bounded, mirroring the light normalization _job_posting_snippet uses in app/llm.py."""
    cleaned = " ".join(text.split())
    return cleaned[:MAX_RESUME_CHARS]


def _extract_pdf(data: bytes) -> str:
    # Parse boundary: any failure on untrusted bytes (corrupt/encrypted PDF, pypdf internals)
    # becomes a clean ResumeParseError rather than a 500.
    try:
        reader = PdfReader(io.BytesIO(data))
        page_count = len(reader.pages)
    except Exception as exc:  # noqa: BLE001 -- deliberate parse boundary, re-raised as a 4xx
        raise ResumeParseError("Could not read the PDF file.") from exc
    # Check the page count before extracting any text, so a huge PDF costs almost nothing.
    if page_count > MAX_PDF_PAGES:
        raise ResumeParseError(f"Resume PDFs can be at most {MAX_PDF_PAGES} pages.")
    try:
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:  # noqa: BLE001 -- deliberate parse boundary, re-raised as a 4xx
        raise ResumeParseError("Could not read the PDF file.") from exc


def _extract_docx(data: bytes) -> str:
    # Guard against a decompression bomb BEFORE python-docx reads any member: the ZIP central
    # directory lists each part's declared uncompressed size, and reading infolist() only parses
    # that metadata -- it does not decompress. Reject if the total exceeds the cap.
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
    except Exception as exc:  # noqa: BLE001 -- deliberate parse boundary, re-raised as a 4xx
        raise ResumeParseError("Could not read the Word (.docx) file.") from exc
    # Any ZIP starts with PK\x03\x04; a Word document is the one with this main part.
    if not any(info.filename == _DOCX_MAIN_PART for info in infos):
        raise ResumeParseError(_UNSUPPORTED)
    total_uncompressed = sum(info.file_size for info in infos)
    if total_uncompressed > MAX_DECOMPRESSED_BYTES:
        raise ResumeParseError("The .docx file is too large when decompressed.")

    # python-docx raises a variety of errors on a bad file (PackageNotFoundError, BadZipFile, ...);
    # treat them all as an unreadable upload.
    try:
        document = Document(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001 -- deliberate parse boundary, re-raised as a 4xx
        raise ResumeParseError("Could not read the Word (.docx) file.") from exc
    return "\n".join(p.text for p in document.paragraphs)


def extract_resume_text(data: bytes) -> str:
    """Parse an uploaded resume to normalized plain text.

    Dispatches on the file's content (PDF magic bytes, or a ZIP containing word/document.xml), not
    its filename or declared content-type, both of which the client controls. Raises
    ResumeParseError on an unsupported type, a PDF over MAX_PDF_PAGES, a file that can't be parsed,
    or one with no extractable text (e.g. a scanned/image-only PDF -- there is no OCR).
    """
    if data.startswith(_PDF_MAGIC):
        text = _extract_pdf(data)
    elif data.startswith(_ZIP_MAGIC):
        text = _extract_docx(data)
    else:
        raise ResumeParseError(_UNSUPPORTED)

    normalized = _normalize(text)
    if not normalized:
        raise ResumeParseError(
            "No text could be extracted. If your resume is a scanned image, upload a text-based "
            "PDF or a .docx instead."
        )
    return normalized
