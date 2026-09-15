"""BUG-2: an unhandled 500 must still carry CORS headers, so the browser surfaces the real error
instead of a misleading "blocked by CORS policy" message.

Run with:
    ./venv/bin/python -m unittest discover -s tests -v
"""
import unittest

from fastapi.testclient import TestClient

import main


class ErrorResponseCors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # A route that always raises, mounted on the real app so the real exception handler and
        # middleware stack run against it.
        async def _boom():
            raise RuntimeError("boom")

        main.app.add_api_route("/__test_boom", _boom, methods=["GET"])
        # raise_server_exceptions=False so the 500 response is returned rather than re-raised.
        cls.client = TestClient(main.app, raise_server_exceptions=False)

    def test_500_carries_cors_header_for_allowed_origin(self):
        origin = "http://localhost:5173"  # main.py's default CORS allowlist
        r = self.client.get("/__test_boom", headers={"Origin": origin})
        self.assertEqual(r.status_code, 500)
        self.assertEqual(r.headers.get("access-control-allow-origin"), origin)
        self.assertEqual(r.json().get("detail"), "Internal Server Error")

    def test_500_omits_cors_header_for_disallowed_origin(self):
        r = self.client.get("/__test_boom", headers={"Origin": "https://evil.example.com"})
        self.assertEqual(r.status_code, 500)
        self.assertIsNone(r.headers.get("access-control-allow-origin"))


if __name__ == "__main__":
    unittest.main()
