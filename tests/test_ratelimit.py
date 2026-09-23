"""Per-user / per-IP rate limiting (app/ratelimit.py): the store, spec parsing, client IP resolution
behind Render's proxy, and 429s on the real routes. No database: get_db and get_current_user are
overridden.

Run with:
    ./venv/bin/python -m unittest discover -s tests -v
"""
import os
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi.testclient import TestClient
from starlette.requests import Request

import main
from app import ratelimit
from app.auth import get_current_user
from app.database import get_db


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class ParseLimits(unittest.TestCase):
    def test_multi_window(self):
        self.assertEqual(ratelimit.parse_limits("10/minute, 30/hour,40/day"), ((10, 60), (30, 3600), (40, 86400)))

    def test_bad_specs_raise(self):
        for spec in ("", "ten/minute", "10/fortnight", "0/minute", "10"):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                ratelimit.parse_limits(spec)

    def test_every_default_parses(self):
        for scope, spec in ratelimit.DEFAULT_LIMITS.items():
            with self.subTest(scope=scope):
                ratelimit.parse_limits(spec)


class InMemoryStore(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.store = ratelimit.InMemoryRateLimitStore(clock=self.clock)

    def test_allows_limit_then_blocks(self):
        windows = ((3, 60),)
        for _ in range(3):
            self.assertIsNone(self.store.hit("k", windows))
        self.assertEqual(self.store.hit("k", windows), 60)

    def test_window_slides(self):
        windows = ((2, 60),)
        self.store.hit("k", windows)
        self.clock.now += 30
        self.store.hit("k", windows)
        self.assertEqual(self.store.hit("k", windows), 30)  # first hit ages out in 30s
        self.clock.now += 30
        self.assertIsNone(self.store.hit("k", windows))

    def test_rejected_requests_are_not_counted(self):
        windows = ((1, 60),)
        self.store.hit("k", windows)
        for _ in range(5):
            self.store.hit("k", windows)
        self.clock.now += 60
        self.assertIsNone(self.store.hit("k", windows))

    def test_longer_window_still_applies(self):
        windows = ((10, 60), (2, 3600))
        self.store.hit("k", windows)
        self.store.hit("k", windows)
        self.clock.now += 120  # minute window clear, hour window full
        self.assertEqual(self.store.hit("k", windows), 3600 - 120)

    def test_keys_are_independent(self):
        windows = ((1, 60),)
        self.assertIsNone(self.store.hit("a", windows))
        self.assertIsNone(self.store.hit("b", windows))


def _request(headers: dict[str, str], peer: str = "10.0.0.1") -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/auth/login",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (peer, 1234),
    })


class ClientIp(unittest.TestCase):
    def test_rightmost_forwarded_entry_by_default(self):
        with mock.patch.dict(os.environ, {"CLIENT_IP_HEADER": "", "TRUSTED_PROXY_COUNT": ""}):
            self.assertEqual(ratelimit.client_ip(_request({"X-Forwarded-For": "1.1.1.1, 2.2.2.2"})), "2.2.2.2")

    def test_spoofed_leftmost_entry_ignored(self):
        with mock.patch.dict(os.environ, {"CLIENT_IP_HEADER": "", "TRUSTED_PROXY_COUNT": ""}):
            spoofed = _request({"X-Forwarded-For": "203.0.113.9, 5.5.5.5"})
            self.assertEqual(ratelimit.client_ip(spoofed), "5.5.5.5")

    def test_trusted_proxy_count(self):
        with mock.patch.dict(os.environ, {"CLIENT_IP_HEADER": "", "TRUSTED_PROXY_COUNT": "2"}):
            req = _request({"X-Forwarded-For": "203.0.113.9, 5.5.5.5, 10.1.1.1"})
            self.assertEqual(ratelimit.client_ip(req), "5.5.5.5")

    def test_too_few_hops_is_unknown_not_leftmost_or_peer(self):
        with mock.patch.dict(os.environ, {"CLIENT_IP_HEADER": "", "TRUSTED_PROXY_COUNT": "2"}):
            self.assertEqual(ratelimit.client_ip(_request({"X-Forwarded-For": "203.0.113.9"})), "unknown")

    def test_configured_header(self):
        with mock.patch.dict(os.environ, {"CLIENT_IP_HEADER": "CF-Connecting-IP"}):
            req = _request({"CF-Connecting-IP": "8.8.8.8", "X-Forwarded-For": "1.1.1.1"})
            self.assertEqual(ratelimit.client_ip(req), "8.8.8.8")

    def test_no_headers_is_unknown_not_peer(self):
        with mock.patch.dict(os.environ, {"CLIENT_IP_HEADER": "", "TRUSTED_PROXY_COUNT": ""}):
            self.assertEqual(ratelimit.client_ip(_request({})), "unknown")

    def test_configured_header_missing_is_unknown_and_logs_no_ip(self):
        with mock.patch.dict(os.environ, {"CLIENT_IP_HEADER": "cf-connecting-ip"}):
            req = _request({"X-Forwarded-For": "203.0.113.9, 5.5.5.5"})
            with self.assertLogs("app.ratelimit", level="WARNING") as logs:
                self.assertEqual(ratelimit.client_ip(req), "unknown")
        self.assertNotRegex("\n".join(logs.output), r"\d+\.\d+\.\d+\.\d+")

    def test_ip_debug_logging_removed(self):
        self.assertFalse(hasattr(ratelimit, "_log_ip_debug"))


def _db_finding_nothing():
    db = mock.MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    return db


class RoutesReturn429(unittest.TestCase):
    def setUp(self):
        ratelimit.store.reset()
        self.db = _db_finding_nothing()
        main.app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        ratelimit.store.reset()

    def test_login_limited_by_ip(self):
        body = {"email": "someone@example.com", "password": "wrong-password"}
        with mock.patch.dict(os.environ, {"RATE_LIMIT_LOGIN": "2/minute", "CLIENT_IP_HEADER": ""}):
            self.assertEqual(self.client.post("/auth/login", json=body).status_code, 401)
            self.assertEqual(self.client.post("/auth/login", json=body).status_code, 401)
            r = self.client.post("/auth/login", json=body)
        self.assertEqual(r.status_code, 429)
        self.assertEqual(r.json()["detail"], "Too many requests. Please wait 1 minute before trying again.")
        self.assertEqual(r.headers["retry-after"], "60")

    def test_login_buckets_are_per_ip(self):
        body = {"email": "someone@example.com", "password": "wrong-password"}
        with mock.patch.dict(os.environ, {"RATE_LIMIT_LOGIN": "1/minute", "CLIENT_IP_HEADER": ""}):
            self.client.post("/auth/login", json=body, headers={"X-Forwarded-For": "1.1.1.1"})
            r = self.client.post("/auth/login", json=body, headers={"X-Forwarded-For": "2.2.2.2"})
        self.assertEqual(r.status_code, 401)

    def test_register_limited_by_ip(self):
        body = {"email": "new@example.com", "display_name": "New", "password": "a-long-password"}
        self.db.query.return_value.filter.return_value.first.return_value = object()  # email taken
        with mock.patch.dict(os.environ, {"RATE_LIMIT_REGISTER": "1/hour", "CLIENT_IP_HEADER": ""}):
            self.assertEqual(self.client.post("/auth/register", json=body).status_code, 409)
            self.assertEqual(self.client.post("/auth/register", json=body).status_code, 429)

    def test_generate_limited_per_user(self):
        user = SimpleNamespace(id=1)
        main.app.dependency_overrides[get_current_user] = lambda: user
        with mock.patch.dict(os.environ, {"RATE_LIMIT_GENERATE": "2/hour"}):
            self.assertEqual(self.client.post("/sessions/99/questions").status_code, 404)
            self.assertEqual(self.client.post("/sessions/99/questions").status_code, 404)
            r = self.client.post("/sessions/99/questions")
            self.assertEqual(r.status_code, 429)
            self.assertIn("Too many requests", r.json()["detail"])

            # A different user has their own bucket.
            user.id = 2
            self.assertEqual(self.client.post("/sessions/99/questions").status_code, 404)

    def test_each_limited_session_route(self):
        main.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=7)
        cases = [
            ("CREATE_SESSION", "post", "/sessions", {"json": {"job_posting": "x" * 30}}),
            ("ANSWER", "post", "/sessions/1/questions/1/answer", {"json": {"answer": "hi"}}),
            ("COMPLETE", "patch", "/sessions/1", {}),
            ("RESUME", "post", "/sessions/1/resume", {"files": {"file": ("r.pdf", b"%PDF-1.4")}}),
        ]
        for scope, method, path, kwargs in cases:
            with self.subTest(scope=scope), mock.patch.dict(os.environ, {f"RATE_LIMIT_{scope}": "1/hour"}):
                # The create route would commit; its first (allowed) call may fail downstream, which
                # is fine -- only the second call's 429 matters here.
                TestClient(main.app, raise_server_exceptions=False).request(method, path, **kwargs)
                r = self.client.request(method, path, **kwargs)
                self.assertEqual(r.status_code, 429)

    def test_unauthenticated_gets_401_not_429(self):
        with mock.patch.dict(os.environ, {"RATE_LIMIT_GENERATE": "1/hour"}):
            self.assertEqual(self.client.post("/sessions/1/questions").status_code, 401)
            self.assertEqual(self.client.post("/sessions/1/questions").status_code, 401)


if __name__ == "__main__":
    unittest.main()
