import os

from dotenv import load_dotenv

load_dotenv()


def _is_mock_mode() -> bool:
    return os.getenv("USE_MOCK_LLM", "false").lower() == "true"


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

    raise NotImplementedError(
        "Real LLM provider not yet wired up. Set USE_MOCK_LLM=true in .env to use mock responses."
    )


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

    raise NotImplementedError(
        "Real LLM provider not yet wired up. Set USE_MOCK_LLM=true in .env to use mock responses."
    )
