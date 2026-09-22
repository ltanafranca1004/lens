"""Tests for the rule-based weak-dimension aggregation and the narrow study-note synthesis.

Run with:
    ./venv/bin/python -m unittest discover -s tests -v
"""
import json
import unittest
from types import SimpleNamespace
from unittest import mock

import app.llm as L
from app import groq_usage
import app.study as S
from app.llm_errors import LLMBadResponse

# Mocked Groq calls still pass the daily budget check; keep it off the database.
groq_usage.set_store(groq_usage.InMemoryUsageStore())


def _rubric(scores, reasoning="", evidence=None):
    """Build a stored-rubric dict for the four dimensions from a {dimension: score} map."""
    ev = list(evidence or [])
    return {d: {"score": scores[d], "evidence": list(ev), "reasoning": reasoning} for d in L._RUBRIC_ORDER}


def _q(skipped=False, rubric=None):
    """Minimal stand-in for a Question row (only .skipped and .rubric are read)."""
    return SimpleNamespace(skipped=skipped, rubric=rubric)


def _fake_client(content):
    resp = mock.Mock()
    resp.choices = [mock.Mock(message=mock.Mock(content=content))]
    client = mock.Mock()
    client.chat.completions.create.return_value = resp
    return client


class ComputeWeakDimensions(unittest.TestCase):
    def test_single_weakest(self):
        q = _q(rubric=_rubric({"completeness": 4, "substance": 2, "reasoning": 4, "correctness": 4}))
        # substance (2) is well below the next-lowest (4), so only it is weak
        self.assertEqual(S.compute_weak_dimensions([q]), ["substance"])

    def test_two_close_weakest_within_margin(self):
        q = _q(rubric=_rubric({"completeness": 4, "substance": 2, "reasoning": 2, "correctness": 5}))
        # substance and reasoning tie at 2 -> both weak, weakest first by rubric order
        self.assertEqual(S.compute_weak_dimensions([q]), ["substance", "reasoning"])

    def test_second_outside_margin_excluded(self):
        q = _q(rubric=_rubric({"completeness": 5, "substance": 2, "reasoning": 3, "correctness": 5}))
        # reasoning (3) is >0.5 above substance (2) -> only substance
        self.assertEqual(S.compute_weak_dimensions([q]), ["substance"])

    def test_averages_across_questions(self):
        q1 = _q(rubric=_rubric({"completeness": 5, "substance": 2, "reasoning": 2, "correctness": 5}))
        q2 = _q(rubric=_rubric({"completeness": 5, "substance": 2, "reasoning": 3, "correctness": 5}))
        # substance avg 2.0, reasoning avg 2.5 -> within 0.5 margin -> both weak
        self.assertEqual(S.compute_weak_dimensions([q1, q2]), ["substance", "reasoning"])

    def test_skipped_and_rubricless_excluded(self):
        good = _q(rubric=_rubric({"completeness": 4, "substance": 2, "reasoning": 4, "correctness": 4}))
        questions = [_q(skipped=True, rubric=None), _q(rubric=None), good]
        self.assertEqual(S.compute_weak_dimensions(questions), ["substance"])

    def test_no_qualifying_returns_empty(self):
        self.assertEqual(S.compute_weak_dimensions([_q(skipped=True), _q(rubric=None)]), [])


class BuildStudyNote(unittest.TestCase):
    def test_returns_none_without_qualifying_questions(self):
        self.assertIsNone(S.build_study_note([_q(skipped=True), _q(rubric=None)]))

    def test_mock_mode_produces_note_naming_weak_dimension(self):
        q = _q(rubric=_rubric({"completeness": 4, "substance": 2, "reasoning": 4, "correctness": 4}))
        with mock.patch.object(L, "_is_mock_mode", return_value=True):
            note = S.build_study_note([q])
        self.assertIsInstance(note, str)
        self.assertTrue(note.strip())
        self.assertIn("substance", note.lower())

    def test_only_evidence_and_reasoning_reach_the_model_as_data(self):
        q = _q(rubric=_rubric(
            {"completeness": 4, "substance": 2, "reasoning": 4, "correctness": 4},
            reasoning="REASON_TOKEN",
            evidence=["EVIDENCE_TOKEN"],
        ))
        with mock.patch.object(L, "_is_mock_mode", return_value=False), \
             mock.patch.object(L, "_get_client",
                               return_value=_fake_client(json.dumps({"study_note": "study this"}))) as gc:
            note = S.build_study_note([q])

        self.assertEqual(note, "study this")
        messages = gc.return_value.chat.completions.create.call_args.kwargs["messages"]
        system = messages[0]["content"]
        user = messages[1]["content"]
        # evidence/reasoning are DATA -> user channel only, never the instruction channel
        self.assertIn("REASON_TOKEN", user)
        self.assertIn("EVIDENCE_TOKEN", user)
        self.assertNotIn("REASON_TOKEN", system)
        self.assertNotIn("EVIDENCE_TOKEN", system)
        # the grounding guardrail lives in the immutable instructions
        self.assertIn("do NOT introduce generic", system)


class GenerateStudyNote(unittest.TestCase):
    def test_empty_weak_areas_returns_none(self):
        self.assertIsNone(L.generate_study_note([]))

    def test_rejects_malformed_model_response(self):
        weak = [{"dimension": "substance", "average": 2.0, "items": [{"reasoning": "x", "evidence": []}]}]
        with mock.patch.object(L, "_is_mock_mode", return_value=False), \
             mock.patch.object(L, "_get_client", return_value=_fake_client(json.dumps({"wrong": "shape"}))):
            with self.assertRaises(LLMBadResponse):
                L.generate_study_note(weak)


if __name__ == "__main__":
    unittest.main()
