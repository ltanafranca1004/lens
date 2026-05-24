import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel

load_dotenv()

GEMINI_MODEL = "gemini-2.5-flash"


class _AnswerEvaluation(BaseModel):
    score: int
    feedback: str


def _is_mock_mode() -> bool:
    return os.getenv("USE_MOCK_LLM", "false").lower() == "true"


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set in the environment")
    return genai.Client(api_key=api_key)


def _job_posting_snippet(job_posting: str, max_chars: int = 180) -> str:
    cleaned = " ".join(job_posting.split())
    if len(cleaned) <= max_chars:
        return cleaned
    truncated = cleaned[:max_chars].rsplit(" ", 1)[0]
    return f"{truncated}..."


def _mock_generate_questions(job_posting: str) -> list[str]:
    snippet = _job_posting_snippet(job_posting)
    return [
        "Walk me through your approach to debugging a complex issue you've encountered. What tools and techniques do you rely on?",
        f'The posting describes: "{snippet}" — tell me about your experience with the responsibilities and technologies it lists.',
        "Describe a project you're proud of. What was your role, and what tradeoffs did you make during the design?",
        "How do you decide when to write tests, and what kinds of tests do you find most valuable in practice?",
        "Tell me about a time you disagreed with a teammate about a technical decision. How did you resolve it?",
    ]


def generate_questions(job_posting: str) -> list[str]:
    if _is_mock_mode():
        return _mock_generate_questions(job_posting)

    client = _get_client()
    prompt = (
        "You are a technical interviewer. Based on the job posting below, generate "
        "exactly 5 technical interview questions tailored to the role and the skills "
        "it describes. Return ONLY a JSON array of 5 strings, with no extra text and "
        "no markdown.\n\n"
        f"Job posting:\n{job_posting}"
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=list[str],
            ),
        )
    except genai_errors.APIError as exc:
        raise RuntimeError(
            f"Gemini API call failed during question generation: {exc}"
        ) from exc

    try:
        questions = json.loads(response.text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError(
            f"Could not parse Gemini question response as JSON: {response.text!r}"
        ) from exc

    if not isinstance(questions, list) or not all(
        isinstance(q, str) for q in questions
    ):
        raise RuntimeError(
            f"Gemini returned an unexpected shape for questions: {questions!r}"
        )

    return questions


def _answer_snippet(answer: str, max_chars: int = 100) -> str:
    cleaned = " ".join(answer.split())
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rsplit(' ', 1)[0]}..."


def _mock_evaluate_answer(_question: str, answer: str) -> dict:
    length = len(answer.strip())
    snippet = _answer_snippet(answer)

    if length < 50:
        score = 2
        feedback = (
            f'Your answer ("{snippet}") is quite brief. Strong responses usually include a concrete '
            "example, your specific role, and the outcome — try to expand with more detail next time."
        )
    elif length < 200:
        score = 3
        feedback = (
            f'You\'re on the right track with "{snippet}", but the response stays at a high level. '
            "Walk through the steps you took, the trade-offs you weighed, and what you learned."
        )
    elif length < 500:
        score = 4
        feedback = (
            f'Good response — "{snippet}" gives a solid example. To push it further, name the specific '
            "tools or techniques you used and quantify the impact where you can."
        )
    else:
        score = 5
        feedback = (
            "Excellent depth. You walked through the situation, your actions, and the result clearly. "
            "Consider tightening the structure (situation → task → action → result) if it ever runs long in a real interview."
        )

    return {"score": score, "feedback": feedback}


def evaluate_answer(question: str, answer: str) -> dict:
    if _is_mock_mode():
        return _mock_evaluate_answer(question, answer)

    client = _get_client()
    prompt = (
        "You are a technical interviewer evaluating a candidate's answer. Score the "
        "answer from 1 to 5 using this rubric:\n"
        "1-2 = too brief or off-topic\n"
        "3 = on track but surface level\n"
        "4 = solid with good detail\n"
        "5 = excellent depth with concrete examples and clear structure\n\n"
        "Provide concise, constructive written feedback. Return ONLY a JSON object with "
        'the keys "score" (an integer 1-5) and "feedback" (a string), with no extra '
        "text and no markdown.\n\n"
        f"Question:\n{question}\n\n"
        f"Candidate's answer:\n{answer}"
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_AnswerEvaluation,
            ),
        )
    except genai_errors.APIError as exc:
        raise RuntimeError(
            f"Gemini API call failed during answer evaluation: {exc}"
        ) from exc

    try:
        data = json.loads(response.text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError(
            f"Could not parse Gemini evaluation response as JSON: {response.text!r}"
        ) from exc

    try:
        score = int(data["score"])
        feedback = str(data["feedback"])
    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError(
            f"Gemini returned an unexpected shape for the evaluation: {data!r}"
        ) from exc

    return {"score": score, "feedback": feedback}
