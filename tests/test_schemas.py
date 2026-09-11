"""Tests for QuestionOut serialization of the per-dimension rubric.

The rubric is produced by evaluate_answer and stored on questions.rubric (JSONB); this asserts the
API response schema actually carries it (score/evidence/reasoning per dimension) so the frontend can
render the marked-up feedback. Serialization is the whole contract, so it is tested directly against
the schema rather than through a DB/TestClient round trip.

    ./venv/bin/python -m unittest discover -s tests -v
"""
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

import app.llm as L
from app.schemas import QuestionOut


def _question_row(rubric):
    """Minimal stand-in for a Question ORM row for from_attributes validation."""
    return SimpleNamespace(
        id=1,
        question_text="How do you debug?",
        user_answer="I reproduce it, then bisect.",
        ai_feedback="Overall score: 4/5.",
        score=4,
        rubric=rubric,
        skipped=False,
        order_index=0,
        answered_at=datetime.now(timezone.utc),
    )


class QuestionOutRubric(unittest.TestCase):
    def test_rubric_serialized_with_all_dimensions(self):
        rubric = {
            d: {"score": 4, "evidence": [f"{d} quote"], "reasoning": f"{d} reasoning"}
            for d in L._RUBRIC_ORDER
        }
        dumped = QuestionOut.model_validate(_question_row(rubric)).model_dump()

        self.assertIn("rubric", dumped)
        self.assertEqual(set(dumped["rubric"]), set(L._RUBRIC_ORDER))
        for d in L._RUBRIC_ORDER:
            entry = dumped["rubric"][d]
            self.assertEqual(entry["score"], 4)
            self.assertEqual(entry["evidence"], [f"{d} quote"])
            self.assertEqual(entry["reasoning"], f"{d} reasoning")

    def test_rubric_null_for_unanswered_question(self):
        # A question created but not yet answered has rubric NULL; the field must round-trip as None.
        row = SimpleNamespace(
            id=2,
            question_text="Unanswered?",
            user_answer=None,
            ai_feedback=None,
            score=None,
            rubric=None,
            skipped=False,
            order_index=1,
            answered_at=None,
        )
        dumped = QuestionOut.model_validate(row).model_dump()
        self.assertIsNone(dumped["rubric"])

    def test_rubric_matches_evaluate_answer_shape(self):
        # The mock evaluator returns the same {score, evidence, reasoning} per dimension the real one
        # does; QuestionOut must accept that shape unchanged.
        result = L._mock_evaluate_answer("q", "A reasonably detailed answer that clears the bar.")
        dumped = QuestionOut.model_validate(_question_row(result["rubric"])).model_dump()
        self.assertEqual(set(dumped["rubric"]), set(L._RUBRIC_ORDER))
        for d in L._RUBRIC_ORDER:
            self.assertEqual(dumped["rubric"][d]["score"], result["rubric"][d]["score"])


if __name__ == "__main__":
    unittest.main()
