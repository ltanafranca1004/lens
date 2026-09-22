"""Typed failures from the LLM layer (app/llm.py).

Each carries the HTTP status and a plain, user-facing message; main.py maps any LLMError straight to
a JSON response with that message as "detail" (the frontend shows detail as-is). Internal details
(raw model output, Groq's own error text) are logged, never returned to the client.
"""
import math


class LLMError(Exception):
    status_code = 503
    message = "The AI service is temporarily unavailable. Please try again shortly."

    def __init__(self, internal: str = ""):
        # `internal` is for logs/tests only; the client only ever sees `message`.
        super().__init__(internal or self.message)


class LLMRateLimited(LLMError):
    """Groq itself returned 429 (org-wide RPM/TPM/RPD/TPD limits). Carries Groq's own retry wait,
    rounded up to whole seconds, for the message and the Retry-After header."""

    status_code = 429
    DEFAULT_RETRY_AFTER = 60  # when Groq sends no usable retry-after header

    def __init__(self, internal: str = "", retry_after: int | None = None):
        self.retry_after = retry_after if retry_after and retry_after > 0 else self.DEFAULT_RETRY_AFTER
        super().__init__(internal)

    @property
    def message(self) -> str:  # type: ignore[override]
        return f"The AI service is busy right now. Please wait {_wait_phrase(self.retry_after)} and try again."


def _wait_phrase(seconds: int) -> str:
    if seconds <= 10:
        return "a few seconds"
    if seconds < 60:
        return f"{seconds} seconds"
    if seconds < 3600:
        minutes = math.ceil(seconds / 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    hours = math.ceil(seconds / 3600)
    return f"{hours} hour{'s' if hours != 1 else ''}"


class LLMUnavailable(LLMError):
    """Any other Groq API failure: timeout, connection error, 5xx, request too large, no API key."""


class LLMBudgetExhausted(LLMError):
    """Lens's own global daily Groq cap (app/groq_usage.py) has been reached."""

    message = "Lens has reached its daily AI limit. Please try again tomorrow."


class LLMBadResponse(LLMError):
    """The model answered, but its output was unparseable or the wrong shape."""

    status_code = 502
    message = "The AI returned an unexpected response. Please try again."
