"""Global daily Groq circuit breaker.

Groq's free tier for openai/gpt-oss-120b is org-wide: 30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD.
Tokens per day is the limit that binds first (a full session is ~7 calls / ~15-25k tokens), so the
daily row tracks both calls and tokens and trips on whichever cap is hit first. The counter lives in
Postgres (one row per UTC day) so it survives restarts and Render spin-downs, unlike the in-memory
per-user limiter in app/ratelimit.py.

Storage sits behind UsageStore so tests and local dev can use the in-memory store
(GROQ_USAGE_STORE=memory) without a database.
"""
import logging
import os
import threading
from datetime import date, datetime, timezone
from typing import Protocol

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.llm_errors import LLMBudgetExhausted, LLMUnavailable

logger = logging.getLogger(__name__)

# 90% of Groq's free-tier RPD / TPD, leaving headroom for calls already in flight.
DEFAULT_DAILY_CALL_CAP = 900
DEFAULT_DAILY_TOKEN_CAP = 180_000


class UsageStore(Protocol):
    def reserve_call(self, day: date) -> tuple[int, int]:
        """Atomically count one more call for `day`; return (calls incl. this one, tokens so far)."""
        ...

    def add_tokens(self, day: date, tokens: int) -> None: ...


# Upsert-and-increment in one statement, so concurrent requests can't both read the same count.
_RESERVE_SQL = text(
    "INSERT INTO groq_daily_usage (day, calls, tokens) VALUES (:day, 1, 0) "
    "ON CONFLICT (day) DO UPDATE SET calls = groq_daily_usage.calls + 1 "
    "RETURNING calls, tokens"
)
_ADD_TOKENS_SQL = text(
    "INSERT INTO groq_daily_usage (day, calls, tokens) VALUES (:day, 0, :tokens) "
    "ON CONFLICT (day) DO UPDATE SET tokens = groq_daily_usage.tokens + :tokens"
)


class PostgresUsageStore:
    """Runs on its own short connection, so the count commits even if the request later rolls back."""

    def reserve_call(self, day: date) -> tuple[int, int]:
        from app.database import engine  # lazy: app.database builds the engine at import time

        with engine.begin() as conn:
            row = conn.execute(_RESERVE_SQL, {"day": day}).one()
        return row.calls, row.tokens

    def add_tokens(self, day: date, tokens: int) -> None:
        from app.database import engine

        with engine.begin() as conn:
            conn.execute(_ADD_TOKENS_SQL, {"day": day, "tokens": tokens})


class InMemoryUsageStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rows: dict[date, list[int]] = {}

    def reserve_call(self, day: date) -> tuple[int, int]:
        with self._lock:
            row = self._rows.setdefault(day, [0, 0])
            row[0] += 1
            return row[0], row[1]

    def add_tokens(self, day: date, tokens: int) -> None:
        with self._lock:
            self._rows.setdefault(day, [0, 0])[1] += tokens


_STORE_KINDS = {"postgres": PostgresUsageStore, "memory": InMemoryUsageStore}
_store: UsageStore | None = None


def get_store() -> UsageStore:
    global _store
    if _store is None:
        kind = os.getenv("GROQ_USAGE_STORE", "postgres").lower()
        if kind not in _STORE_KINDS:
            raise RuntimeError(f"GROQ_USAGE_STORE must be one of {sorted(_STORE_KINDS)}, got {kind!r}")
        _store = _STORE_KINDS[kind]()
    return _store


def set_store(store: UsageStore | None) -> None:
    """Swap the store (tests). None re-reads GROQ_USAGE_STORE on next use."""
    global _store
    _store = store


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    return int(raw) if raw else default


def _today() -> date:
    return datetime.now(timezone.utc).date()


def reserve_call() -> None:
    """Count one Groq call against today's budget, or raise LLMBudgetExhausted if a cap is hit.

    Attempts are counted even if the call then fails -- deliberate for a circuit breaker. A database
    error fails closed (LLMUnavailable) rather than letting calls through uncounted.
    """
    try:
        calls, tokens = get_store().reserve_call(_today())
    except SQLAlchemyError as exc:
        logger.exception("Could not reserve Groq budget")
        raise LLMUnavailable(f"usage store error: {exc}") from exc
    call_cap = _env_int("GROQ_DAILY_CALL_CAP", DEFAULT_DAILY_CALL_CAP)
    token_cap = _env_int("GROQ_DAILY_TOKEN_CAP", DEFAULT_DAILY_TOKEN_CAP)
    if calls > call_cap or tokens >= token_cap:
        logger.warning("Groq daily cap reached: calls=%s/%s tokens=%s/%s", calls, call_cap, tokens, token_cap)
        raise LLMBudgetExhausted(f"daily Groq cap reached: calls={calls} tokens={tokens}")


def record_tokens(tokens: int) -> None:
    """Add a completed call's token usage to today's row. Best-effort: a failure here is logged,
    never surfaced, since the user's call already succeeded."""
    if tokens <= 0:
        return
    try:
        get_store().add_tokens(_today(), tokens)
    except SQLAlchemyError:
        logger.exception("Could not record Groq token usage")
