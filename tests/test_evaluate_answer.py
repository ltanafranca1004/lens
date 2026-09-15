"""Answer-evaluation scoring tests: the central-dimension overall cap (NEW-1) and evidence quote
cleaning/matching (NEW-2).

Run with:
    ./venv/bin/python -m unittest discover -s tests -v
"""
import json
import unittest
from unittest import mock

import app.llm as L


def _scores(completeness, substance, reasoning, correctness):
    return {
        "completeness": completeness,
        "substance": substance,
        "reasoning": reasoning,
        "correctness": correctness,
    }


def _fake_client(content):
    resp = mock.Mock()
    resp.choices = [mock.Mock(message=mock.Mock(content=content))]
    client = mock.Mock()
    client.chat.completions.create.return_value = resp
    return client


class DimensionCeiling(unittest.TestCase):
    def test_ceiling_values(self):
        self.assertEqual(L._dimension_ceiling(1), 2)
        self.assertEqual(L._dimension_ceiling(2), 3)
        self.assertEqual(L._dimension_ceiling(3), 5)
        self.assertEqual(L._dimension_ceiling(5), 5)


class CombineOverall(unittest.TestCase):
    def test_completeness_1_caps_overall_low(self):
        # NEW-1: a well-written answer that doesn't address the question must not score high.
        self.assertLessEqual(L._combine_overall(_scores(1, 5, 5, 5)), 2)

    def test_correctness_1_still_caps_low(self):
        # Regression: the original correctness ceiling still applies.
        self.assertLessEqual(L._combine_overall(_scores(5, 5, 5, 1)), 2)

    def test_completeness_2_caps_at_3(self):
        self.assertLessEqual(L._combine_overall(_scores(2, 5, 5, 5)), 3)

    def test_correctness_2_caps_at_3(self):
        self.assertLessEqual(L._combine_overall(_scores(5, 5, 5, 2)), 3)

    def test_tighter_cap_wins(self):
        # completeness 1 (cap 2) with correctness 2 (cap 3) -> the tighter cap, 2, applies.
        self.assertLessEqual(L._combine_overall(_scores(1, 5, 5, 2)), 2)

    def test_no_cap_is_rounded_average(self):
        self.assertEqual(L._combine_overall(_scores(4, 4, 4, 4)), 4)
        self.assertEqual(L._combine_overall(_scores(5, 5, 5, 5)), 5)
        # avg of 4,4,3,4 = 3.75 -> 4, and no central dimension is <= 2
        self.assertEqual(L._combine_overall(_scores(4, 4, 3, 4)), 4)


class EvaluateAnswerWiring(unittest.TestCase):
    def test_completeness_1_caps_returned_score_end_to_end(self):
        # NEW-1 through evaluate_answer with a mocked Groq client: strong on every dimension but
        # off-topic (completeness 1) -> the overall must still be capped low.
        answer = (
            "I would validate the request body with a Pydantic model. "
            "Then I would open a transaction and commit only if every step succeeds."
        )
        model_json = json.dumps(
            {
                "completeness": {"score": 1, "evidence": [], "reasoning": "off topic"},
                "substance": {"score": 5, "evidence": [], "reasoning": "dense"},
                "reasoning": {"score": 5, "evidence": [], "reasoning": "clear"},
                "correctness": {"score": 5, "evidence": [], "reasoning": "accurate"},
            }
        )
        with mock.patch.object(L, "_is_mock_mode", return_value=False), mock.patch.object(
            L, "_get_client", return_value=_fake_client(model_json)
        ):
            result = L.evaluate_answer("A question about databases", answer)
        self.assertLessEqual(result["score"], 2)
        self.assertEqual(result["rubric"]["completeness"]["score"], 1)
        self.assertIn("completeness", result["feedback"].lower())


class CleanPhraseAndEvidence(unittest.TestCase):
    def test_clean_phrase_strips_quotes_and_ellipsis(self):
        self.assertEqual(L._clean_phrase('"…I mint a JWT…"'), "I mint a JWT")  # quotes outside ellipsis
        self.assertEqual(L._clean_phrase('… "I mint a JWT" …'), "I mint a JWT")  # ellipsis outside quotes
        self.assertEqual(L._clean_phrase("‘I mint a JWT’"), "I mint a JWT")
        self.assertEqual(L._clean_phrase("...leading dots"), "leading dots")
        self.assertEqual(L._clean_phrase("plain phrase"), "plain phrase")

    def test_wrapped_evidence_survives_and_is_stored_clean(self):
        # NEW-2: a real quote the model wrapped in quotes/ellipsis still matches and is stored clean,
        # regardless of which wrapper is on the outside.
        answer = "On success I mint a JWT with the user id in the sub claim."
        for quote in ('"…I mint a JWT…"', '… "I mint a JWT" …'):
            parsed = L._parse_dim({"score": 4, "evidence": [quote], "reasoning": "ok"}, "reasoning", answer)
            self.assertEqual(parsed["evidence"], ["I mint a JWT"], quote)

    def test_fabricated_quote_is_still_dropped(self):
        answer = "On success I mint a JWT."
        parsed = L._parse_dim({"score": 4, "evidence": ["a phrase not in the answer"], "reasoning": "x"}, "reasoning", answer)
        self.assertEqual(parsed["evidence"], [])


if __name__ == "__main__":
    unittest.main()
