"""Groq failures map to typed LLMErrors and then to clean 429/502/503 responses, never a generic
500. The Groq client is mocked; no network or database.

Run with:
    ./venv/bin/python -m unittest discover -s tests -v
"""
import os
import unittest
from types import SimpleNamespace
from unittest import mock

import groq
import httpx
from fastapi.testclient import TestClient

import app.llm as L
import main
from app import groq_usage, ratelimit
from app.auth import get_current_user
from app.database import get_db
from app.llm_errors import LLMBadResponse, LLMRateLimited, LLMUnavailable

_REQ = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")


def _status_error(cls, code):
    return cls(f"groq said {code}", response=httpx.Response(code, request=_REQ), body=None)


def _raising_client(exc):
    client = mock.Mock()
    client.chat.completions.create.side_effect = exc
    return client


def _content_client(content):
    resp = mock.Mock()
    resp.choices = [mock.Mock(message=mock.Mock(content=content))]
    resp.usage = None
    client = mock.Mock()
    client.chat.completions.create.return_value = resp
    return client


CASES = [
    ("rate limit", _status_error(groq.RateLimitError, 429), LLMRateLimited),
    ("server error", _status_error(groq.InternalServerError, 500), LLMUnavailable),
    ("request too large", _status_error(groq.APIStatusError, 413), LLMUnavailable),
    ("timeout", groq.APITimeoutError(request=_REQ), LLMUnavailable),
    ("connection", groq.APIConnectionError(request=_REQ), LLMUnavailable),
]


class ErrorMapping(unittest.TestCase):
    def setUp(self):
        groq_usage.set_store(groq_usage.InMemoryUsageStore())

    def _evaluate(self, client):
        with mock.patch.object(L, "_is_mock_mode", return_value=False), \
             mock.patch.object(L, "_get_client", return_value=client):
            return L.evaluate_answer("What is a closure?", "A closure captures variables.")

    def test_groq_errors_map_to_typed_errors(self):
        for name, exc, expected in CASES:
            with self.subTest(name), self.assertRaises(expected):
                self._evaluate(_raising_client(exc))

    def test_bad_json_is_bad_response(self):
        with self.assertRaises(LLMBadResponse):
            self._evaluate(_content_client("not json"))

    def test_missing_dimension_is_bad_response(self):
        with self.assertRaises(LLMBadResponse):
            self._evaluate(_content_client('{"completeness": {"score": 3}}'))

    def test_missing_api_key_is_unavailable(self):
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": ""}), self.assertRaises(LLMUnavailable):
            L._get_client()

    def test_client_has_no_retries_and_a_timeout(self):
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": "test-key", "GROQ_TIMEOUT_SECONDS": "12"}), \
             mock.patch.object(L, "Groq") as groq_cls:
            L._get_client()
        groq_cls.assert_called_once_with(api_key="test-key", max_retries=0, timeout=12.0)


class ErrorResponses(unittest.TestCase):
    def setUp(self):
        groq_usage.set_store(groq_usage.InMemoryUsageStore())
        ratelimit.store.reset()
        main.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        # raise_server_exceptions=False so an unmapped error would show up as a 500, not a raise.
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        ratelimit.store.reset()

    def _answer_with(self, client):
        db = mock.MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [
            SimpleNamespace(id=1, user_id=1),
            SimpleNamespace(id=1, skipped=False, user_answer=None, question_text="What is a closure?"),
        ]
        main.app.dependency_overrides[get_db] = lambda: db
        with mock.patch.object(L, "_is_mock_mode", return_value=False), \
             mock.patch.object(L, "_get_client", return_value=client):
            return self.client.post(
                "/sessions/1/questions/1/answer",
                json={"answer": "A closure captures variables."},
                headers={"Origin": "http://localhost:5173"},
            )

    def test_status_and_detail_per_failure(self):
        expected = {
            LLMRateLimited: (429, "The AI service is busy right now. Please wait a minute and try again."),
            LLMUnavailable: (503, "The AI service is temporarily unavailable. Please try again shortly."),
        }
        for name, exc, err_cls in CASES:
            with self.subTest(name):
                r = self._answer_with(_raising_client(exc))
                status_code, detail = expected[err_cls]
                self.assertEqual(r.status_code, status_code)
                self.assertEqual(r.json()["detail"], detail)
                # Rendered inside CORSMiddleware, so the browser can read the message.
                self.assertEqual(r.headers.get("access-control-allow-origin"), "http://localhost:5173")

    def test_rate_limited_sets_retry_after(self):
        r = self._answer_with(_raising_client(_status_error(groq.RateLimitError, 429)))
        self.assertEqual(r.headers.get("retry-after"), "60")

    def test_bad_response_is_502(self):
        r = self._answer_with(_content_client("not json"))
        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()["detail"], "The AI returned an unexpected response. Please try again.")


if __name__ == "__main__":
    unittest.main()
