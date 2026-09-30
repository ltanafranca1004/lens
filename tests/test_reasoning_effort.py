"""Reasoning effort per stage: question generation and the study note ask Groq for "low";
answer evaluation sends no reasoning_effort at all (its effort is what the 50-example eval
validated, so it must not change without re-running that eval).

Run with:
    ./venv/bin/python -m unittest discover -s tests -v
"""
import json
import unittest
from unittest import mock

import app.llm as L
from app import groq_usage

groq_usage.set_store(groq_usage.InMemoryUsageStore())


def _client(payload: dict):
    resp = mock.Mock()
    resp.choices = [mock.Mock(message=mock.Mock(content=json.dumps(payload)))]
    resp.usage = None
    client = mock.Mock()
    client.chat.completions.create.return_value = resp
    return client


def _create_kwargs(payload: dict, call):
    client = _client(payload)
    with mock.patch.object(L, "_is_mock_mode", return_value=False), \
         mock.patch.object(L, "_get_client", return_value=client):
        call()
    return client.chat.completions.create.call_args.kwargs


class ReasoningEffort(unittest.TestCase):
    def test_question_generation_uses_low(self):
        kwargs = _create_kwargs(
            {"questions": [f"Question {i}?" for i in range(5)]},
            lambda: L.generate_questions("Backend Engineer (Co-op) building FastAPI services."),
        )
        self.assertEqual(kwargs["reasoning_effort"], "low")

    def test_study_note_uses_low(self):
        weak = [{"dimension": "substance", "average": 2.0, "items": [{"reasoning": "thin", "evidence": ["x"]}]}]
        kwargs = _create_kwargs({"study_note": "study this"}, lambda: L.generate_study_note(weak))
        self.assertEqual(kwargs["reasoning_effort"], "low")

    def test_answer_evaluation_sends_no_reasoning_effort(self):
        payload = {
            d: {"score": 3, "evidence": ["an index"], "reasoning": "ok"} for d in L._RUBRIC_ORDER
        }
        kwargs = _create_kwargs(
            payload, lambda: L.evaluate_answer("How would you speed up a query?", "Add an index.")
        )
        self.assertNotIn("reasoning_effort", kwargs)


if __name__ == "__main__":
    unittest.main()
