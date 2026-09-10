import json
import os

from dotenv import load_dotenv
from groq import APIError, Groq

load_dotenv()

GROQ_MODEL = "openai/gpt-oss-120b"


def _is_mock_mode() -> bool:
    return os.getenv("USE_MOCK_LLM", "false").lower() == "true"


def _get_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set in the environment")
    return Groq(api_key=api_key)


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
        "it describes. Return ONLY a JSON object of the form "
        '{"questions": ["...", "...", "...", "...", "..."]} containing exactly 5 '
        "question strings, with no extra text and no markdown.\n\n"
        f"Job posting:\n{job_posting}"
    )

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
    except APIError as exc:
        raise RuntimeError(
            f"Groq API call failed during question generation: {exc}"
        ) from exc

    content = response.choices[0].message.content
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError(
            f"Could not parse Groq question response as JSON: {content!r}"
        ) from exc

    questions = data.get("questions") if isinstance(data, dict) else None
    if (
        not isinstance(questions, list)
        or len(questions) != 5
        or not all(isinstance(q, str) for q in questions)
    ):
        raise RuntimeError(
            f"Groq returned an unexpected shape for questions: {data!r}"
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


# --- Rubric-based evaluation (v1) --------------------------------------------
# Dimension definitions copied VERBATIM from synthetic_data/lens_rubric_v1.md
# (sections 1-4). Embedded here (rather than read at runtime) so production has
# no dependency on that git-excluded prototype directory.
_RUBRIC = {
    "completeness": (
        "Does the answer actually address what was asked, regardless of length.\n"
        "- 1: Doesn't answer the question at all, or answers a different question\n"
        "- 2: Touches the topic but misses the core of what was asked\n"
        "- 3: Addresses the question but leaves out an important part\n"
        "- 4: Addresses the question fully\n"
        "- 5: Addresses the question fully and anticipates a natural follow-up"
    ),
    "substance": (
        "Length isn't the signal. Does the content earn its length, or is it padded/repeated.\n"
        "- 1: Empty or a single unsupported assertion\n"
        "- 2: Mostly filler, buzzwords, or restating the question\n"
        "- 3: Some real content, some padding or repetition\n"
        "- 4: Content is dense, little to no padding\n"
        "- 5: Every sentence adds distinct information"
    ),
    "reasoning": (
        "Does it explain why, not just what. Tradeoffs, mechanisms, causes.\n"
        "- 1: No reasoning, just a claim or fact\n"
        "- 2: Gestures at reasoning without actually explaining it\n"
        "- 3: Some reasoning, but shallow or incomplete\n"
        "- 4: Clear reasoning connecting the answer to the underlying mechanism or tradeoff\n"
        "- 5: Reasoning that shows awareness of alternatives or edge cases"
    ),
    "correctness": (
        "Verify against real docs/sources when outside your own expertise. Do not trust "
        "confident phrasing.\n"
        "- 1: Central claim is factually wrong\n"
        "- 2: Mostly right but contains a meaningful factual error\n"
        "- 3: Correct but imprecise or missing a caveat\n"
        "- 4: Fully correct\n"
        "- 5: Fully correct and precise about edge cases or exceptions"
    ),
}
_RUBRIC_ORDER = ("completeness", "substance", "reasoning", "correctness")
_DISPLAY = {
    "completeness": "Completeness",
    "substance": "Substance density",
    "reasoning": "Reasoning",
    "correctness": "Correctness",
}


def _build_rubric_prompt(question: str, answer: str) -> str:
    defs = "\n\n".join(f"{_DISPLAY[d].upper()}:\n{_RUBRIC[d]}" for d in _RUBRIC_ORDER)
    return (
        "You are scoring a candidate's interview answer on FOUR independent dimensions: "
        "completeness, substance density, reasoning, and correctness.\n"
        "Use ONLY these rubric definitions (do not invent your own criteria):\n\n"
        f"{defs}\n\n"
        "SUBSTANCE ENFORCEMENT: if the answer is a single sentence or makes only one "
        "assertion/point -- however fluent, confident, or technical-sounding -- its Substance "
        "density score must not exceed 2.\n\n"
        f"Question asked:\n{question}\n\n"
        f"Candidate's answer:\n{answer}\n\n"
        "For EACH dimension: first identify specific evidence in the ANSWER (quote exact "
        "phrases/sentences from the answer; use an empty list if there is none), THEN assign a "
        "score from 1 to 5 using that dimension's rubric definition above.\n"
        "Return ONLY a JSON object, no markdown, exactly:\n"
        '{"completeness": {"score": <int 1-5>, "evidence": [<quoted strings>], "reasoning": "<one sentence>"}, '
        '"substance": {"score": <int 1-5>, "evidence": [<quoted strings>], "reasoning": "<one sentence>"}, '
        '"reasoning": {"score": <int 1-5>, "evidence": [<quoted strings>], "reasoning": "<one sentence>"}, '
        '"correctness": {"score": <int 1-5>, "evidence": [<quoted strings>], "reasoning": "<one sentence>"}}'
    )


def _parse_dim(obj, name: str) -> dict:
    if not isinstance(obj, dict):
        raise RuntimeError(f"Groq evaluation missing or malformed dimension: {name!r}")
    raw = obj.get("score")
    if isinstance(raw, bool):
        raise RuntimeError(f"Groq returned an invalid score for {name!r}: {raw!r}")
    try:
        score = int(round(float(raw)))
    except (TypeError, ValueError):
        raise RuntimeError(f"Groq returned a non-numeric score for {name!r}: {raw!r}")
    score = max(1, min(5, score))
    evidence = obj.get("evidence", [])
    if isinstance(evidence, str):
        evidence = [evidence]
    if not isinstance(evidence, list):
        evidence = []
    evidence = [str(e) for e in evidence]
    reasoning = obj.get("reasoning", "")
    reasoning = "" if reasoning is None else str(reasoning)
    return {"score": score, "evidence": evidence, "reasoning": reasoning}


def _combine_overall(scores: dict) -> int:
    """Correctness-ceiling combination (lens_rubric_v1.md 'Combining into an overall score'):
    correctness 1 caps overall at 2, correctness 2 caps at 3, otherwise overall = rounded
    average of all four dimensions."""
    avg = round(sum(scores[d] for d in _RUBRIC_ORDER) / len(_RUBRIC_ORDER))
    correctness = scores["correctness"]
    if correctness == 1:
        overall = min(avg, 2)
    elif correctness == 2:
        overall = min(avg, 3)
    else:
        overall = avg
    return max(1, min(5, overall))


def _build_feedback(overall: int, dims: dict) -> str:
    scores = {d: dims[d]["score"] for d in _RUBRIC_ORDER}
    avg = round(sum(scores.values()) / len(_RUBRIC_ORDER))
    correctness = scores["correctness"]
    cap = 2 if correctness == 1 else 3 if correctness == 2 else None
    capped = cap is not None and avg > cap

    header = f"Overall score: {overall}/5."
    if capped:
        header = f"Overall score: {overall}/5 (capped by correctness {correctness}/5)."
    lines = [header, ""]

    # lowest-scoring dimension first, so the weakness that drove the score leads;
    # ties fall back to the rubric order for a stable ordering.
    order = sorted(_RUBRIC_ORDER, key=lambda d: (scores[d], _RUBRIC_ORDER.index(d)))
    for d in order:
        info = dims[d]
        line = f"{_DISPLAY[d]} {info['score']}/5: {info['reasoning']}".rstrip()
        if info["evidence"]:
            line += f' (e.g. "{info["evidence"][0]}")'
        lines.append(line)
    return "\n".join(lines)


def evaluate_answer(question: str, answer: str) -> dict:
    if _is_mock_mode():
        return _mock_evaluate_answer(question, answer)

    client = _get_client()
    prompt = _build_rubric_prompt(question, answer)

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
    except APIError as exc:
        raise RuntimeError(
            f"Groq API call failed during answer evaluation: {exc}"
        ) from exc

    content = response.choices[0].message.content
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError(
            f"Could not parse Groq evaluation response as JSON: {content!r}"
        ) from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"Groq evaluation was not a JSON object: {content!r}")

    dims = {d: _parse_dim(data.get(d), d) for d in _RUBRIC_ORDER}
    scores = {d: dims[d]["score"] for d in _RUBRIC_ORDER}
    overall = _combine_overall(scores)
    return {"score": overall, "feedback": _build_feedback(overall, dims)}
