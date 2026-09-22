"""Typed failures from the LLM layer (app/llm.py).

Each carries the HTTP status and a plain, user-facing message; main.py maps any LLMError straight to
a JSON response with that message as "detail" (the frontend shows detail as-is). Internal details
(raw model output, Groq's own error text) are logged, never returned to the client.
"""


class LLMError(Exception):
    status_code = 503
    message = "The AI service is temporarily unavailable. Please try again shortly."

    def __init__(self, internal: str = ""):
        # `internal` is for logs/tests only; the client only ever sees `message`.
        super().__init__(internal or self.message)


class LLMRateLimited(LLMError):
    """Groq itself returned 429 (org-wide RPM/TPM/RPD/TPD limits)."""

    status_code = 429
    message = "The AI service is busy right now. Please wait a minute and try again."


class LLMUnavailable(LLMError):
    """Any other Groq API failure: timeout, connection error, 5xx, request too large, no API key."""


class LLMBudgetExhausted(LLMError):
    """Lens's own global daily Groq cap (app/groq_usage.py) has been reached."""

    message = "Lens has reached its daily AI limit. Please try again tomorrow."


class LLMBadResponse(LLMError):
    """The model answered, but its output was unparseable or the wrong shape."""

    status_code = 502
    message = "The AI returned an unexpected response. Please try again."
