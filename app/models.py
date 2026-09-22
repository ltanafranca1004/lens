from datetime import datetime, timezone
from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    job_posting = Column(Text, nullable=False)
    # Optional resume text parsed from an uploaded PDF/DOCX (see app/resume.py). When present,
    # question generation blends it with the job posting. NULL when the user started from a
    # posting alone. Snapshotted here so Phase 2 can verify answers against the same resume.
    resume_text = Column(Text, nullable=True)
    status = Column(String, default="in_progress")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime(timezone=True), nullable=True)
    study_note = Column(Text, nullable=True)

    user = relationship("User", back_populates="sessions")
    questions = relationship("Question", back_populates="session", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    question_text = Column(Text, nullable=False)
    user_answer = Column(Text, nullable=True)
    ai_feedback = Column(Text, nullable=True)
    score = Column(Integer, nullable=True)
    # Structured per-dimension rubric breakdown (completeness/substance/reasoning/correctness,
    # each {score, evidence[], reasoning}) as returned by evaluate_answer. NULL until answered.
    rubric = Column(JSONB, nullable=True)
    skipped = Column(Boolean, default=False)
    order_index = Column(Integer, nullable=False)
    answered_at = Column(DateTime(timezone=True), nullable=True)

    session = relationship("Session", back_populates="questions")


class GroqDailyUsage(Base):
    """Global Groq usage per UTC day, the circuit breaker in app/groq_usage.py. One row per day;
    written only through that module's atomic upserts."""

    __tablename__ = "groq_daily_usage"

    day = Column(Date, primary_key=True)
    calls = Column(Integer, nullable=False, default=0, server_default="0")
    tokens = Column(BigInteger, nullable=False, default=0, server_default="0")
