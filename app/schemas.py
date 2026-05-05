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


class QuestionOut(BaseModel):
    id: int
    question_text: str
    user_answer: str | None
    ai_feedback: str | None
    score: int | None
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

    model_config = {"from_attributes": True}


class SessionDetail(SessionOut):
    questions: list[QuestionOut]
    average_score: float | None
