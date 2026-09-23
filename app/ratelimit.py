"""Per-user and per-IP request rate limiting, as FastAPI dependencies.

Limits are env-configurable per scope (RATE_LIMIT_<SCOPE>, e.g. RATE_LIMIT_ANSWER="10/minute,30/hour")
and every window in a spec must pass. Over the limit -> 429 with a plain "detail" and Retry-After.

Storage sits behind RateLimitStore; v1 uses the in-memory store (single Render instance). Its counts
reset whenever Render restarts or spins down, so daily windows are soft -- the Postgres-backed global
Groq cap in app/groq_usage.py is the durable backstop. Swapping to Postgres/Redis is one assignment
to `store`.
"""
import logging
import math
import os
import threading
import time
from collections import deque
from collections.abc import Callable
from functools import lru_cache
from typing import Protocol

from fastapi import Depends, HTTPException, Request, status

from app.auth import get_current_user
from app.models import User

logger = logging.getLogger(__name__)

# Starting values, each overridable with RATE_LIMIT_<SCOPE>. Per-user limits are sized so one user
# can't drain the global Groq budget (~8-12 full sessions/day for the whole app on the free tier);
# per-IP limits are loose because many students share one campus/event IP.
DEFAULT_LIMITS = {
    "login": "20/minute,100/hour",
    "register": "20/hour,50/day",
    "create_session": "3/hour,5/day",
    "resume": "5/hour,10/day",
    "generate": "3/hour,5/day",
    "answer": "10/minute,30/hour,40/day",
    "complete": "10/hour",
}

_UNITS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}

Windows = tuple[tuple[int, int], ...]  # ((limit, window_seconds), ...)


@lru_cache(maxsize=64)
def parse_limits(spec: str) -> Windows:
    """Parse "10/minute,30/hour" into ((10, 60), (30, 3600)). Raises ValueError on a bad spec."""
    windows = []
    for part in spec.split(","):
        count, _, unit = part.strip().partition("/")
        count, unit = count.strip(), unit.strip().lower()
        if not count.isdigit() or int(count) < 1 or unit not in _UNITS:
            raise ValueError(f"Invalid rate limit {spec!r}; expected e.g. '10/minute,30/hour'")
        windows.append((int(count), _UNITS[unit]))
    return tuple(windows)


class RateLimitStore(Protocol):
    def hit(self, key: str, windows: Windows) -> int | None:
        """Record a request for `key` if every window allows it and return None; otherwise record
        nothing and return the seconds until the request would be allowed."""
        ...


class InMemoryRateLimitStore:
    """Sliding-window log: one deque of request timestamps per key. Sync routes run in FastAPI's
    threadpool, so every access holds a lock."""

    _SWEEP_EVERY = 1000  # hits between sweeps of idle keys

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}
        self._since_sweep = 0

    def hit(self, key: str, windows: Windows) -> int | None:
        now = self._clock()
        longest = max(window for _, window in windows)
        with self._lock:
            self._maybe_sweep(now)
            stamps = self._hits.setdefault(key, deque())
            while stamps and stamps[0] <= now - longest:
                stamps.popleft()

            retry_after = 0.0
            for limit, window in windows:
                in_window = [t for t in stamps if t > now - window]
                if len(in_window) >= limit:
                    # Allowed again once the oldest request that still counts ages out.
                    retry_after = max(retry_after, in_window[-limit] + window - now)
            if retry_after > 0:
                return max(1, math.ceil(retry_after))

            stamps.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def _maybe_sweep(self, now: float) -> None:
        # Drop keys with no request inside the longest supported window, so memory stays bounded.
        self._since_sweep += 1
        if self._since_sweep < self._SWEEP_EVERY:
            return
        self._since_sweep = 0
        horizon = now - _UNITS["day"]
        for key in [k for k, s in self._hits.items() if not s or s[-1] <= horizon]:
            del self._hits[key]


store: RateLimitStore = InMemoryRateLimitStore()


def client_ip(request: Request) -> str:
    """The caller's IP behind Render's proxy. Production sets CLIENT_IP_HEADER=cf-connecting-ip:
    single-valued, set by Cloudflare, and rejected by Cloudflare when a client supplies it. Without
    it (local dev), the X-Forwarded-For entry TRUSTED_PROXY_COUNT positions from the right (default
    1); the leftmost entry is client-controlled and never used. Never falls back to the socket peer,
    which uvicorn rewrites from X-Forwarded-For. Unresolvable callers share one "unknown" bucket."""
    header = os.getenv("CLIENT_IP_HEADER", "").strip().lower()
    if header:
        value = request.headers.get(header, "").strip()
        if value:
            return value
        logger.warning("client-ip header %s missing on %s", header, request.url.path)
        return "unknown"
    hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
    n = max(1, int(os.getenv("TRUSTED_PROXY_COUNT") or 1))
    return hops[-n] if len(hops) >= n else "unknown"


def _format_wait(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    if seconds < 3600:
        minutes = math.ceil(seconds / 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    hours = math.ceil(seconds / 3600)
    return f"{hours} hour{'s' if hours != 1 else ''}"


def _enforce(scope: str, key: str) -> None:
    spec = os.getenv(f"RATE_LIMIT_{scope.upper()}") or DEFAULT_LIMITS[scope]
    retry_after = store.hit(f"{scope}:{key}", parse_limits(spec))
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many requests. Please wait {_format_wait(retry_after)} before trying again.",
            headers={"Retry-After": str(retry_after)},
        )


def limit_by_user(scope: str) -> Callable[..., None]:
    """Dependency: limit the authenticated user's requests for `scope`."""

    def dependency(current_user: User = Depends(get_current_user)) -> None:
        _enforce(scope, f"user:{current_user.id}")

    return dependency


def limit_by_ip(scope: str) -> Callable[..., None]:
    """Dependency: limit a (possibly anonymous) caller's requests for `scope` by client IP."""

    def dependency(request: Request) -> None:
        _enforce(scope, f"ip:{client_ip(request)}")

    return dependency
