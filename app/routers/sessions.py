from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DbSession

from app.auth import get_current_user
from app.database import get_db
from app.llm import evaluate_answer, generate_questions
from app.models import Question, Session, User
from app.schemas import AnswerSubmit, QuestionOut, SessionCreate, SessionDetail, SessionOut

router = APIRouter(prefix="/sessions", tags=["sessions"])


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


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
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
        questions=session.questions,
        average_score=average,
    )


@router.post(
    "/{session_id}/questions",
    response_model=list[QuestionOut],
    status_code=status.HTTP_201_CREATED,
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

    question_texts = generate_questions(session.job_posting)
    questions = [
        Question(session_id=session.id, question_text=text, order_index=i)
        for i, text in enumerate(question_texts)
    ]
    db.add_all(questions)
    db.commit()
    for q in questions:
        db.refresh(q)
    return questions


@router.post("/{session_id}/questions/{question_id}/answer", response_model=QuestionOut)
def submit_answer(
    session_id: int,
    question_id: int,
    payload: AnswerSubmit,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Question:
    _, question = _get_owned_question(session_id, question_id, current_user, db)

    if question.skipped or question.user_answer is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This question has already been answered or skipped",
        )

    result = evaluate_answer(question.question_text, payload.answer)
    question.user_answer = payload.answer
    question.score = result["score"]
    question.ai_feedback = result["feedback"]
    question.answered_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(question)
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

    question.skipped = True
    db.commit()
    db.refresh(question)
    return question


@router.patch("/{session_id}", response_model=SessionOut)
def complete_session(
    session_id: int,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Session:
    session = _get_owned_session(session_id, current_user, db)
    session.status = "completed"
    session.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(session)
    return session
