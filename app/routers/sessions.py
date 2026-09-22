import asyncio
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session as DbSession

from app.auth import get_current_user
from app.database import get_db
from app.llm import evaluate_answer, generate_questions
from app.llm_errors import LLMError
from app.models import Question, Session, User
from app.ratelimit import limit_by_user
from app.resume import MAX_UPLOAD_BYTES, ResumeParseError, extract_resume_text
from app.schemas import (
    AnswerSubmit,
    QuestionOut,
    ResumeUploadResult,
    SessionCreate,
    SessionDetail,
    SessionOut,
)
from app.study import build_study_note

router = APIRouter(prefix="/sessions", tags=["sessions"])

DEFAULT_RESUME_PARSE_TIMEOUT_SECONDS = 10.0


def _get_owned_session(session_id: int, user: User, db: DbSession) -> Session:
    session = db.query(Session).filter(Session.id == session_id).first()
    if session is None or session.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )
    return session


def _get_owned_question(
    session_id: int, question_id: int, user: User, db: DbSession
) -> tuple[Session, Question]:
    session = _get_owned_session(session_id, user, db)
    question = (
        db.query(Question)
        .filter(Question.id == question_id, Question.session_id == session.id)
        .first()
    )
    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found",
        )
    return session, question


@router.post(
    "",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_by_user("create_session"))],
)
def create_session(
    payload: SessionCreate,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Session:
    session = Session(user_id=current_user.id, job_posting=payload.job_posting)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("", response_model=list[SessionOut])
def list_sessions(
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Session]:
    return (
        db.query(Session)
        .filter(Session.user_id == current_user.id)
        .order_by(Session.created_at.desc())
        .all()
    )


@router.get("/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: int,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SessionDetail:
    session = _get_owned_session(session_id, current_user, db)
    scores = [q.score for q in session.questions if q.score is not None]
    average = sum(scores) / len(scores) if scores else None
    return SessionDetail(
        id=session.id,
        job_posting=session.job_posting,
        status=session.status,
        created_at=session.created_at,
        completed_at=session.completed_at,
        study_note=session.study_note,
        questions=session.questions,
        average_score=average,
    )


@router.post(
    "/{session_id}/resume",
    response_model=ResumeUploadResult,
    dependencies=[Depends(limit_by_user("resume"))],
)
async def upload_resume(
    session_id: int,
    file: UploadFile = File(...),
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResumeUploadResult:
    session = _get_owned_session(session_id, current_user, db)

    # The resume must be attached before questions are generated: generation snapshots
    # session.resume_text, so a late upload could never influence the questions.
    existing = db.query(Question).filter(Question.session_id == session.id).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Questions have already been generated; upload the resume before generating.",
        )

    # Reject an oversized upload without materializing the whole body in memory: check the
    # parser-reported size when available, and read at most one byte past the cap so a large
    # body can't be fully loaded into a bytes object here.
    too_large = HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=f"Resume file is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).",
    )
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise too_large
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise too_large
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    # Parse in a worker thread so a slow file can't block the event loop, and give up after a
    # timeout. Python can't kill the thread, so a timed-out parse still finishes in the background;
    # MAX_PDF_PAGES and the decompression cap bound how long that can take.
    timeout = float(
        os.getenv("RESUME_PARSE_TIMEOUT_SECONDS") or DEFAULT_RESUME_PARSE_TIMEOUT_SECONDS
    )
    try:
        resume_text = await asyncio.wait_for(
            asyncio.to_thread(extract_resume_text, data), timeout=timeout
        )
    except ResumeParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Your resume took too long to process. Try a simpler PDF or a .docx.",
        ) from exc

    session.resume_text = resume_text
    db.commit()
    return ResumeUploadResult(filename=file.filename or "", resume_chars=len(resume_text))


@router.post(
    "/{session_id}/questions",
    response_model=list[QuestionOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_by_user("generate"))],
)
def create_questions(
    session_id: int,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Question]:
    session = _get_owned_session(session_id, current_user, db)

    existing = db.query(Question).filter(Question.session_id == session.id).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Questions have already been generated for this session",
        )

    question_texts = generate_questions(session.job_posting, session.resume_text)
    questions = [
        Question(session_id=session.id, question_text=text, order_index=i)
        for i, text in enumerate(question_texts)
    ]
    db.add_all(questions)
    db.commit()
    for q in questions:
        db.refresh(q)
    return questions


@router.post(
    "/{session_id}/questions/{question_id}/answer",
    response_model=QuestionOut,
    dependencies=[Depends(limit_by_user("answer"))],
)
def submit_answer(
    session_id: int,
    question_id: int,
    payload: AnswerSubmit,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Question:
    _, question = _get_owned_question(session_id, question_id, current_user, db)

    # Fast fail (and skip a needless Groq call) when it is already answered/skipped.
    if question.skipped or question.user_answer is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This question has already been answered or skipped",
        )

    result = evaluate_answer(question.question_text, payload.answer)

    # Commit the transition atomically: the WHERE re-checks the pre-state, so of two concurrent
    # answer/skip requests only one wins and the other gets 409 — never skipped + answered together.
    updated = (
        db.query(Question)
        .filter(
            Question.id == question.id,
            Question.user_answer.is_(None),
            Question.skipped.is_(False),
        )
        .update(
            {
                Question.user_answer: payload.answer,
                Question.score: result["score"],
                Question.ai_feedback: result["feedback"],
                Question.rubric: result.get("rubric"),
                Question.answered_at: datetime.now(timezone.utc),
            },
            synchronize_session=False,
        )
    )
    db.commit()
    if updated == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This question has already been answered or skipped",
        )
    db.refresh(question)  # synchronize_session=False left the ORM object stale
    return question


@router.post("/{session_id}/questions/{question_id}/skip", response_model=QuestionOut)
def skip_question(
    session_id: int,
    question_id: int,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Question:
    _, question = _get_owned_question(session_id, question_id, current_user, db)

    if question.skipped or question.user_answer is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This question has already been answered or skipped",
        )

    # Same atomic conditional update as submit_answer, so a concurrent answer can't slip in first.
    updated = (
        db.query(Question)
        .filter(
            Question.id == question.id,
            Question.user_answer.is_(None),
            Question.skipped.is_(False),
        )
        .update({Question.skipped: True}, synchronize_session=False)
    )
    db.commit()
    if updated == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This question has already been answered or skipped",
        )
    db.refresh(question)
    return question


@router.patch(
    "/{session_id}",
    response_model=SessionOut,
    dependencies=[Depends(limit_by_user("complete"))],
)
def complete_session(
    session_id: int,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Session:
    session = _get_owned_session(session_id, current_user, db)
    was_in_progress = session.status == "in_progress"
    session.status = "completed"
    session.completed_at = datetime.now(timezone.utc)

    # Generate the "what to study" note once, only on the in_progress -> completed transition, so a
    # Groq failure is never retried on a repeated PATCH (no retry in V1) and an already-completed
    # session is never regenerated. A failure leaves study_note NULL without blocking completion.
    if was_in_progress:
        try:
            session.study_note = build_study_note(session.questions)
        except LLMError:
            session.study_note = None

    db.commit()
    db.refresh(session)
    return session
