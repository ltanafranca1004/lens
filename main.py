import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from app.routers import auth, sessions

load_dotenv()

app = FastAPI()

# Comma-separated allowlist; defaults to the local Vite dev origin.
_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173")
allow_origins = [o.strip() for o in _origins.split(",") if o.strip()]

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
    if origin and (origin in allow_origins or "*" in allow_origins):
        headers["Access-Control-Allow-Origin"] = "*" if "*" in allow_origins else origin
        headers["Vary"] = "Origin"
    return JSONResponse(
        status_code=500, content={"detail": "Internal Server Error"}, headers=headers
    )


app.include_router(auth.router)
app.include_router(sessions.router)


@app.get("/")
def root():
    return {"status": "ok"}
