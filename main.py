import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from app.llm_errors import LLMError, LLMRateLimited
from app.routers import auth, sessions

load_dotenv()


def _docs_settings() -> dict[str, str | None]:
    # /docs, /redoc and /openapi.json are off unless ENABLE_API_DOCS=true (local dev only).
    if os.getenv("ENABLE_API_DOCS", "").lower() == "true":
        return {}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


def _parse_cors_origins(raw: str) -> list[str]:
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if "*" in origins:
        raise RuntimeError("CORS_ORIGINS must list explicit origins; '*' is not allowed")
    return origins


app = FastAPI(**_docs_settings())

# Comma-separated allowlist; defaults to the local Vite dev origin.
allow_origins = _parse_cors_origins(os.getenv("CORS_ORIGINS", "http://localhost:5173"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,  # auth is a Bearer token in the header, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)


# Unhandled exceptions become a 500 via Starlette's ServerErrorMiddleware, which sits OUTSIDE
# CORSMiddleware -- so that default 500 ships with no CORS header and a browser reports a
# misleading CORS error instead of the real failure. This handler runs in that same outer layer,
# so it attaches the CORS header itself (echoing the request origin when it's allowed) and returns
# a clean JSON body the frontend can parse.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    origin = request.headers.get("origin")
    headers: dict[str, str] = {}
    if origin and origin in allow_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return JSONResponse(
        status_code=500, content={"detail": "Internal Server Error"}, headers=headers
    )


# Groq failures and the daily AI cap become a clean 429/502/503 with a plain "detail" the frontend
# shows as-is. Class-specific handlers run inside CORSMiddleware, so CORS headers apply normally.
@app.exception_handler(LLMError)
async def llm_error_handler(request: Request, exc: LLMError) -> JSONResponse:
    headers = {"Retry-After": str(exc.retry_after)} if isinstance(exc, LLMRateLimited) else None
    return JSONResponse(
        status_code=exc.status_code, content={"detail": exc.message}, headers=headers
    )


app.include_router(auth.router)
app.include_router(sessions.router)


@app.get("/")
def root():
    return {"status": "ok"}
