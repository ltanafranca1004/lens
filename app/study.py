"""Session-level "what to study" synthesis.

Rule-based, no AI: aggregate the per-dimension rubric scores stored on each answered question,
identify the session's weakest dimension(s), then hand ONLY that weak-dimension evidence/reasoning
to the narrow `llm.generate_study_note` call. Keeping the deterministic aggregation here (separate
from the LLM boundary in app/llm.py) means it is unit-testable without the network.
"""
from app.llm import _DISPLAY, _RUBRIC_ORDER, generate_study_note

# When the second-weakest dimension's average is within this margin of the weakest, treat both as
# genuinely weak and study-note them together; otherwise focus on the single weakest. Tunable.
_SECOND_WEAK_MARGIN = 0.5


def _dim_score(rubric: dict, dimension: str) -> float | None:
    """Numeric per-dimension score from a stored rubric, or None if missing/malformed."""
    entry = rubric.get(dimension)
    if not isinstance(entry, dict):
        return None
    raw = entry.get("score")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return float(raw)


def _qualifying(questions) -> list:
    """Answered questions that carry a structured rubric (skipped/unanswered excluded)."""
    return [q for q in questions if not q.skipped and isinstance(q.rubric, dict)]


def _dimension_averages(questions) -> dict[str, float]:
    """Average score per dimension across qualifying questions. Dimensions with no scores are
    omitted; returns {} when nothing qualifies."""
    qualifying = _qualifying(questions)
    averages: dict[str, float] = {}
    for d in _RUBRIC_ORDER:
        scores = [s for q in qualifying if (s := _dim_score(q.rubric, d)) is not None]
        if scores:
            averages[d] = sum(scores) / len(scores)
    return averages


def compute_weak_dimensions(questions) -> list[str]:
    """The 1-2 weakest dimensions across the session's answered questions, weakest first.

    Always includes the single lowest-average dimension; adds the second-lowest only when it is
    within _SECOND_WEAK_MARGIN of the lowest. Ties break by rubric order for stability. Returns []
    when no answered question has a rubric.
    """
    averages = _dimension_averages(questions)
    if not averages:
        return []

    ordered = sorted(averages, key=lambda d: (averages[d], _RUBRIC_ORDER.index(d)))
    weakest = [ordered[0]]
    if len(ordered) > 1 and averages[ordered[1]] - averages[ordered[0]] <= _SECOND_WEAK_MARGIN:
        weakest.append(ordered[1])
    return weakest


def build_study_note(questions) -> str | None:
    """Compute the weak dimension(s) and synthesize a study note grounded only in their evidence.

    Returns None when there is nothing to synthesize (no answered questions with a rubric). May
    raise RuntimeError if the underlying LLM call fails; callers decide how to handle that.
    """
    weak = compute_weak_dimensions(questions)
    if not weak:
        return None

    averages = _dimension_averages(questions)
    qualifying = _qualifying(questions)

    weak_areas = []
    for d in weak:
        items = []
        for q in qualifying:
            entry = q.rubric.get(d)
            if not isinstance(entry, dict):
                continue
            reasoning = (entry.get("reasoning") or "").strip()
            evidence = [e for e in (entry.get("evidence") or []) if isinstance(e, str) and e.strip()]
            if reasoning or evidence:
                items.append({"reasoning": reasoning, "evidence": evidence})
        weak_areas.append({"dimension": d, "average": averages[d], "items": items})

    return generate_study_note(weak_areas)
