from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field
from pydantic_core import PydanticCustomError

BCRYPT_MAX_PASSWORD_BYTES = 72


def _within_bcrypt_limit(password: str) -> str:
    # bcrypt only accepts 72 bytes (bcrypt 5 raises past that), so reject with a 422 instead of a 500.
    if len(password.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise PydanticCustomError(
            "password_too_long",
            "Password is too long (max 72 bytes; some characters count as more than one).",
        )
    return password


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=80)
    password: Annotated[str, Field(min_length=8, max_length=128), AfterValidator(_within_bcrypt_limit)]


class UserLogin(BaseModel):
    email: EmailStr
    password: Annotated[str, AfterValidator(_within_bcrypt_limit)]


class UserOut(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# Text caps keep a single Groq request (prompt + input + output) under the free tier's 8,000
# tokens/minute; see also MAX_RESUME_CHARS in app/resume.py.
class SessionCreate(BaseModel):
    job_posting: str = Field(min_length=20, max_length=12000)


class AnswerSubmit(BaseModel):
    answer: str = Field(min_length=1, max_length=6000)


class RubricDimensionOut(BaseModel):
    """One rubric dimension as produced by evaluate_answer and stored on questions.rubric."""

    score: int
    evidence: list[str]
    reasoning: str


class QuestionOut(BaseModel):
    id: int
    question_text: str
    user_answer: str | None
    ai_feedback: str | None
    score: int | None
    # Per-dimension breakdown (completeness/substance/reasoning/correctness), each with
    # score/evidence/reasoning. NULL until the question is answered. Read straight off the JSONB
    # column via from_attributes; Pydantic coerces each value into RubricDimensionOut.
    rubric: dict[str, RubricDimensionOut] | None = None
    skipped: bool
    order_index: int
    answered_at: datetime | None

    model_config = {"from_attributes": True}


class SessionOut(BaseModel):
    id: int
    job_posting: str
    status: str
    created_at: datetime
    completed_at: datetime | None
    study_note: str | None = None

    model_config = {"from_attributes": True}


class SessionDetail(SessionOut):
    questions: list[QuestionOut]
    average_score: float | None


class ResumeUploadResult(BaseModel):
    """Confirmation returned after a resume is parsed and stored on the session."""

    filename: str
    resume_chars: int
