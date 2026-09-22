"""Global daily Groq cap (app/groq_usage.py): trips on calls or tokens, and surfaces as a 503 with a
plain message through a real route. Uses the in-memory store; the Postgres upsert is exercised
manually against a local database (see the PR).

Run with:
    ./venv/bin/python -m unittest discover -s tests -v
"""
import json
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
from app.llm_errors import LLMBudgetExhausted, LLMRateLimited, LLMUnavailable


def _fake_client(content: str, total_tokens: int = 1000):
    resp = mock.Mock()
    resp.choices = [mock.Mock(message=mock.Mock(content=content))]
    resp.usage = mock.Mock(total_tokens=total_tokens)
    client = mock.Mock()
    client.chat.completions.create.return_value = resp
    return client


_STUDY_JSON = json.dumps({"study_note": "Review closures."})
_WEAK = [{"dimension": "substance", "average": 2.0, "items": [{"reasoning": "x", "evidence": []}]}]


class DailyCap(unittest.TestCase):
    def setUp(self):
        self.store = groq_usage.InMemoryUsageStore()
        groq_usage.set_store(self.store)

    def tearDown(self):
        groq_usage.set_store(groq_usage.InMemoryUsageStore())

    def _call(self, client):
        with mock.patch.object(L, "_is_mock_mode", return_value=False), \
             mock.patch.object(L, "_get_client", return_value=client):
            return L.generate_study_note(_WEAK)

    def test_call_cap(self):
        client = _fake_client(_STUDY_JSON)
        with mock.patch.dict(os.environ, {"GROQ_DAILY_CALL_CAP": "2", "GROQ_DAILY_TOKEN_CAP": "999999"}):
            self._call(client)
            self._call(client)
            with self.assertRaises(LLMBudgetExhausted):
                self._call(client)
        self.assertEqual(client.chat.completions.create.call_count, 2)  # Groq never called past the cap

    def test_token_cap(self):
        client = _fake_client(_STUDY_JSON, total_tokens=600)
        env = {
            "GROQ_DAILY_CALL_CAP": "100",
            "GROQ_DAILY_TOKEN_CAP": "1000",
            "GROQ_TOKENS_PER_CALL_ESTIMATE": "100",
        }
        with mock.patch.dict(os.environ, env):
            self._call(client)  # reserves 100 (total 100), settles to 600
            self._call(client)  # reserves 100 (total 700), settles to 1200
            with self.assertRaises(LLMBudgetExhausted):
                self._call(client)  # reserving 100 more would reach 1300 > 1000
        self.assertEqual(client.chat.completions.create.call_count, 2)

    def test_reservation_settles_to_actual_usage(self):
        with mock.patch.dict(os.environ, {"GROQ_TOKENS_PER_CALL_ESTIMATE": "2000"}):
            self._call(_fake_client(_STUDY_JSON, total_tokens=1234))
        self.assertEqual(self._totals(), (1, 1234))

    def test_concurrent_reservations_count_before_any_call_finishes(self):
        # Two calls in flight reserve their estimates up front, so a third is refused even though
        # neither has reported real usage yet.
        env = {"GROQ_DAILY_TOKEN_CAP": "4500", "GROQ_TOKENS_PER_CALL_ESTIMATE": "2000"}
        with mock.patch.dict(os.environ, env):
            groq_usage.reserve_call()
            groq_usage.reserve_call()
            with self.assertRaises(LLMBudgetExhausted):
                groq_usage.reserve_call()

    def test_cap_rejection_releases_its_estimate(self):
        client = _fake_client(_STUDY_JSON, total_tokens=788)
        env = {"GROQ_DAILY_CALL_CAP": "1", "GROQ_TOKENS_PER_CALL_ESTIMATE": "2000"}
        with mock.patch.dict(os.environ, env):
            self._call(client)
            with self.assertRaises(LLMBudgetExhausted):
                self._call(client)
        # Only the real call's tokens remain; the refused call's estimate was released.
        self.assertEqual(self._totals(), (2, 788))

    def test_rejected_call_releases_its_estimate(self):
        req = httpx.Request("POST", "https://api.groq.com")
        client = mock.Mock()
        client.chat.completions.create.side_effect = groq.RateLimitError(
            "rl", response=httpx.Response(429, request=req), body=None
        )
        with self.assertRaises(LLMRateLimited):
            self._call(client)
        self.assertEqual(self._totals(), (1, 0))

    def test_timeout_keeps_its_estimate(self):
        client = mock.Mock()
        client.chat.completions.create.side_effect = groq.APITimeoutError(
            request=httpx.Request("POST", "https://api.groq.com")
        )
        with mock.patch.dict(os.environ, {"GROQ_TOKENS_PER_CALL_ESTIMATE": "2000"}):
            with self.assertRaises(LLMUnavailable):
                self._call(client)
        self.assertEqual(self._totals(), (1, 2000))

    def test_failed_reconcile_keeps_estimate_and_does_not_raise(self):
        class FailingSettle(groq_usage.InMemoryUsageStore):
            def add_tokens(self, day, tokens):
                raise groq_usage.SQLAlchemyError("db down")

        store = FailingSettle()
        groq_usage.set_store(store)
        with mock.patch.dict(os.environ, {"GROQ_TOKENS_PER_CALL_ESTIMATE": "2000"}):
            self.assertEqual(self._call(_fake_client(_STUDY_JSON, total_tokens=500)), "Review closures.")
        self.assertEqual(store.reserve_call(groq_usage._today(), 0), (2, 2000))  # errs high, not low

    def test_mock_mode_does_not_count(self):
        with mock.patch.object(L, "_is_mock_mode", return_value=True):
            L.generate_study_note(_WEAK)
        self.assertEqual(self._totals(), (0, 0))

    def _totals(self):
        """Current (calls, tokens) for today, read without changing them."""
        calls, tokens = self.store.reserve_call(groq_usage._today(), 0)  # counts itself; undo below
        return calls - 1, tokens


class DailyCapThroughRoute(unittest.TestCase):
    def setUp(self):
        groq_usage.set_store(groq_usage.InMemoryUsageStore())
        ratelimit.store.reset()
        db = mock.MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [
            SimpleNamespace(id=1, user_id=1),  # the owned session
            SimpleNamespace(id=1, skipped=False, user_answer=None, question_text="What is a closure?"),
        ]
        main.app.dependency_overrides[get_db] = lambda: db
        main.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        groq_usage.set_store(groq_usage.InMemoryUsageStore())
        ratelimit.store.reset()

    def test_answer_returns_503_when_cap_reached(self):
        client = _fake_client("{}")
        with mock.patch.dict(os.environ, {"GROQ_DAILY_CALL_CAP": "0"}), \
             mock.patch.object(L, "_is_mock_mode", return_value=False), \
             mock.patch.object(L, "_get_client", return_value=client):
            r = self.client.post("/sessions/1/questions/1/answer", json={"answer": "A closure captures scope."})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["detail"], "Lens has reached its daily AI limit. Please try again tomorrow.")
        client.chat.completions.create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
