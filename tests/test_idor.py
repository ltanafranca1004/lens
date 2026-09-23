"""IDOR: every route that takes a session or question ID must refuse another user's resources with
404 (never 403, never a different 404 than for an ID that doesn't exist), leave their data untouched,
and spend no LLM call or resume parse on them. Two real users, real JWTs, a real Postgres database.

One-time setup (Postgres.app is already running locally):
    createdb lens_test

Run with:
    ./venv/bin/python -m unittest tests.test_idor -v
    ./venv/bin/python -m unittest discover -s tests -v

TEST_DATABASE_URL overrides the default postgresql://localhost/lens_test. The tests refuse any
database that isn't on localhost or whose name doesn't end in _test, and fail if the database is
unreachable. Set LENS_SKIP_DB_TESTS=1 to skip them instead.
"""
import os
import unittest
from datetime import datetime, timezone
from unittest import mock
from urllib.parse import urlparse

import bcrypt
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

import main
from app import auth, groq_usage, ratelimit
from app.database import Base, get_db
from app.models import Question, Session, User

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql://localhost/lens_test")
SKIP_DB_TESTS = os.getenv("LENS_SKIP_DB_TESTS") == "1"

groq_usage.set_store(groq_usage.InMemoryUsageStore())

# Fixture users log in by token, never by password, so a cheap hash keeps setUp fast.
_FIXTURE_HASH = bcrypt.hashpw(b"unused-password", bcrypt.gensalt(rounds=4)).decode()


def _check_test_database_url(url: str) -> None:
    parsed = urlparse(url)
    database = parsed.path.lstrip("/")
    if parsed.hostname not in ("localhost", "127.0.0.1") or not database.endswith("_test"):
        raise RuntimeError(
            f"Refusing to run IDOR tests against host={parsed.hostname!r} db={database!r}: "
            "TEST_DATABASE_URL must be a local database whose name ends in _test."
        )


def _connect():
    _check_test_database_url(TEST_DATABASE_URL)
    engine = create_engine(TEST_DATABASE_URL)
    try:
        with engine.connect():
            pass
    except OperationalError as exc:
        engine.dispose()
        raise AssertionError(
            f"IDOR tests need a local Postgres test database; run: createdb lens_test "
            f"(or set LENS_SKIP_DB_TESTS=1 to skip). Connection failed: {exc.orig}"
        ) from None
    return engine


@unittest.skipIf(SKIP_DB_TESTS, "LENS_SKIP_DB_TESTS=1")
class Idor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = _connect()
        Base.metadata.create_all(cls.engine)
        cls.Db = sessionmaker(bind=cls.engine, autocommit=False, autoflush=False)

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def setUp(self):
        with self.engine.begin() as conn:
            conn.execute(text("TRUNCATE users, sessions, questions RESTART IDENTITY CASCADE"))
        ratelimit.store.reset()

        def _get_test_db():
            db = self.Db()
            try:
                yield db
            finally:
                db.close()

        main.app.dependency_overrides[get_db] = _get_test_db
        self.client = TestClient(main.app)

        env = mock.patch.dict(os.environ, {"USE_MOCK_LLM": "true"})
        env.start()
        self.addCleanup(env.stop)
        import app.routers.sessions as routes

        self.spies = {}
        for name in ("generate_questions", "evaluate_answer", "build_study_note", "extract_resume_text"):
            patcher = mock.patch.object(routes, name, wraps=getattr(routes, name))
            self.spies[name] = patcher.start()
            self.addCleanup(patcher.stop)

        self._seed()

    def tearDown(self):
        main.app.dependency_overrides.clear()
        ratelimit.store.reset()

    # --- fixture -------------------------------------------------------------------------------

    def _seed(self):
        with self.Db() as db:
            a = User(email="a@example.com", display_name="A", password_hash=_FIXTURE_HASH)
            b = User(email="b@example.com", display_name="B", password_hash=_FIXTURE_HASH)
            db.add_all([a, b])
            db.flush()

            sa = Session(user_id=a.id, job_posting="A-POSTING secret backend role at Acme")
            sa2 = Session(
                user_id=a.id,
                job_posting="A-POSTING-2 finished role",
                status="completed",
                completed_at=datetime.now(timezone.utc),
                study_note="A-STUDY-NOTE review indexes",
            )
            sa_empty = Session(user_id=a.id, job_posting="A-POSTING-3 no questions yet")
            sb = Session(user_id=b.id, job_posting="B-POSTING frontend role")
            db.add_all([sa, sa2, sa_empty, sb])
            db.flush()

            qa = [
                Question(session_id=sa.id, question_text=f"A-QUESTION-{i}", order_index=i) for i in range(1, 6)
            ]
            qa[0].user_answer = "A-ANSWER-1"
            qa[0].score = 4
            qa[0].ai_feedback = "A-FEEDBACK-1"
            qa[0].rubric = {"correctness": {"score": 4, "evidence": ["A-EVIDENCE"], "reasoning": "A-REASONING"}}
            qa[0].answered_at = datetime.now(timezone.utc)
            qb = Question(session_id=sb.id, question_text="B-QUESTION-1", order_index=1)
            db.add_all([*qa, qb])
            db.commit()

            self.a_id, self.b_id = a.id, b.id
            self.sa, self.sa2, self.sa_empty, self.sb = sa.id, sa2.id, sa_empty.id, sb.id
            self.qa = [q.id for q in qa]
            self.qb = qb.id

        self.a_headers = {"Authorization": f"Bearer {auth.create_access_token(self.a_id)}"}
        self.b_headers = {"Authorization": f"Bearer {auth.create_access_token(self.b_id)}"}
        self.missing = self.sa + 1000

    # --- helpers -------------------------------------------------------------------------------

    def _as_b(self, method, path, **kwargs):
        return self.client.request(method, path, headers=self.b_headers, **kwargs)

    def _question(self, qid):
        with self.Db() as db:
            q = db.get(Question, qid)
            fields = ("user_answer", "ai_feedback", "score", "rubric", "skipped", "answered_at")
            return {c: getattr(q, c) for c in fields}

    def _session(self, sid):
        with self.Db() as db:
            s = db.get(Session, sid)
            return {
                "status": s.status,
                "completed_at": s.completed_at,
                "study_note": s.study_note,
                "resume_text": s.resume_text,
                "questions": len(s.questions),
            }

    def _assert_not_found(self, r, detail="Session not found"):
        self.assertEqual(r.status_code, 404, r.text)
        self.assertEqual(r.json(), {"detail": detail})
        for marker in ("A-POSTING", "A-QUESTION", "A-ANSWER", "A-FEEDBACK", "A-EVIDENCE", "A-STUDY-NOTE"):
            self.assertNotIn(marker, r.text)

    def _assert_no_side_calls(self):
        for name, spy in self.spies.items():
            self.assertFalse(spy.called, f"{name} was called for another user's resource")

    def _resume_upload(self):
        return {"file": ("resume.pdf", b"%PDF-1.4\n%fake\n", "application/pdf")}

    # --- 1. list -------------------------------------------------------------------------------

    def test_list_shows_only_own_sessions(self):
        r = self._as_b("GET", "/sessions")
        self.assertEqual(r.status_code, 200)
        self.assertEqual([s["id"] for s in r.json()], [self.sb])
        self.assertNotIn("A-POSTING", r.text)

    # --- 2-7. every ID route, B against A's resources -------------------------------------------

    def test_read_other_users_session(self):
        for sid in (self.sa, self.sa2):
            with self.subTest(session=sid):
                self._assert_not_found(self._as_b("GET", f"/sessions/{sid}"))

    def test_upload_resume_to_other_users_session(self):
        before = self._session(self.sa_empty)
        r = self._as_b("POST", f"/sessions/{self.sa_empty}/resume", files=self._resume_upload())
        self._assert_not_found(r)
        self.assertEqual(self._session(self.sa_empty), before)
        self._assert_no_side_calls()

    def test_generate_questions_for_other_users_session(self):
        before = self._session(self.sa_empty)
        self._assert_not_found(self._as_b("POST", f"/sessions/{self.sa_empty}/questions"))
        self.assertEqual(self._session(self.sa_empty), before)
        self.assertEqual(before["questions"], 0)
        self._assert_no_side_calls()

    def test_answer_other_users_question(self):
        qid = self.qa[1]
        before = self._question(qid)
        self._assert_not_found(
            self._as_b("POST", f"/sessions/{self.sa}/questions/{qid}/answer", json={"answer": "B tries to answer"})
        )
        self.assertEqual(self._question(qid), before)
        self.assertIsNone(before["user_answer"])
        self._assert_no_side_calls()

    def test_skip_other_users_question(self):
        qid = self.qa[1]
        before = self._question(qid)
        self._assert_not_found(self._as_b("POST", f"/sessions/{self.sa}/questions/{qid}/skip"))
        self.assertEqual(self._question(qid), before)
        self.assertFalse(before["skipped"])

    def test_complete_other_users_session(self):
        before = self._session(self.sa)
        self._assert_not_found(self._as_b("PATCH", f"/sessions/{self.sa}"))
        self.assertEqual(self._session(self.sa), before)
        self.assertEqual(before["status"], "in_progress")
        self._assert_no_side_calls()

    # --- 8-9. mixed IDs ------------------------------------------------------------------------

    def test_own_session_with_other_users_question(self):
        qid = self.qa[1]
        before = self._question(qid)
        r = self._as_b("POST", f"/sessions/{self.sb}/questions/{qid}/answer", json={"answer": "B tries"})
        self._assert_not_found(r, detail="Question not found")
        r = self._as_b("POST", f"/sessions/{self.sb}/questions/{qid}/skip")
        self._assert_not_found(r, detail="Question not found")
        self.assertEqual(self._question(qid), before)
        self._assert_no_side_calls()

    def test_other_users_session_with_own_question(self):
        before = self._question(self.qb)
        r = self._as_b("POST", f"/sessions/{self.sa}/questions/{self.qb}/answer", json={"answer": "B tries"})
        self._assert_not_found(r)
        self._assert_not_found(self._as_b("POST", f"/sessions/{self.sa}/questions/{self.qb}/skip"))
        self.assertEqual(self._question(self.qb), before)
        self._assert_no_side_calls()

    # --- 10. other user's resource is indistinguishable from a missing one ----------------------

    def test_other_users_resource_looks_like_missing_one(self):
        qid = self.qa[1]
        # (method, path template, A's session to target, request kwargs)
        cases = [
            ("GET", "/sessions/{sid}", self.sa, {}),
            ("POST", "/sessions/{sid}/resume", self.sa_empty, {"files": self._resume_upload()}),
            ("POST", "/sessions/{sid}/questions", self.sa_empty, {}),
            ("POST", "/sessions/{sid}/questions/{qid}/answer", self.sa, {"json": {"answer": "B tries"}}),
            ("POST", "/sessions/{sid}/questions/{qid}/skip", self.sa, {}),
            ("PATCH", "/sessions/{sid}", self.sa, {}),
        ]
        for method, template, sid, kwargs in cases:
            with self.subTest(route=f"{method} {template}"):
                ratelimit.store.reset()
                other = self._as_b(method, template.format(sid=sid, qid=qid), **kwargs)
                missing = self._as_b(method, template.format(sid=self.missing, qid=qid + 1000), **kwargs)
                self.assertEqual((other.status_code, other.content), (missing.status_code, missing.content))
                self.assertEqual(other.status_code, 404)

    # --- 11. auth runs before any lookup --------------------------------------------------------

    def test_missing_or_bad_token_is_401_not_404(self):
        qid = self.qa[1]
        routes = [
            ("GET", f"/sessions/{self.sa}", {}),
            ("POST", f"/sessions/{self.sa_empty}/resume", {"files": self._resume_upload()}),
            ("POST", f"/sessions/{self.sa_empty}/questions", {}),
            ("POST", f"/sessions/{self.sa}/questions/{qid}/answer", {"json": {"answer": "x"}}),
            ("POST", f"/sessions/{self.sa}/questions/{qid}/skip", {}),
            ("PATCH", f"/sessions/{self.sa}", {}),
        ]
        for headers in ({}, {"Authorization": "Bearer not.a.token"}):
            for method, path, kwargs in routes:
                with self.subTest(route=f"{method} {path}", headers=bool(headers)):
                    r = self.client.request(method, path, headers=headers, **kwargs)
                    self.assertEqual(r.status_code, 401, r.text)
        self._assert_no_side_calls()

    # --- 12. positive controls: the fixture is valid, so the 404s above mean something ----------

    def test_owners_can_use_their_own_resources(self):
        r = self.client.get(f"/sessions/{self.sa}", headers=self.a_headers)
        self.assertEqual(r.status_code, 200)
        self.assertIn("A-QUESTION-1", r.text)
        self.assertEqual(self.client.get(f"/sessions/{self.sb}", headers=self.b_headers).status_code, 200)

        r = self.client.post(f"/sessions/{self.sa}/questions/{self.qa[2]}/skip", headers=self.a_headers)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(self._question(self.qa[2])["skipped"])

        r = self.client.post(
            f"/sessions/{self.sa}/questions/{self.qa[3]}/answer",
            headers=self.a_headers,
            json={"answer": "I would add an index on the foreign key and check the query plan."},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsNotNone(self._question(self.qa[3])["score"])
        self.assertTrue(self.spies["evaluate_answer"].called)


if __name__ == "__main__":
    unittest.main()
