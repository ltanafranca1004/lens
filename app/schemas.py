from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SessionCreate(BaseModel):
    job_posting: str = Field(min_length=20, max_length=20000)


class AnswerSubmit(BaseModel):
    answer: str = Field(min_length=1, max_length=10000)


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
