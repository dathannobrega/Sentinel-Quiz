from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db.session import get_db
from app.core.config import settings
from app.models import Exam, ExamSession, SessionQuestion, SessionAnswer, Question, Option, Explanation
from app.schemas import (
    ExamOut, CreateSessionIn, SessionOut, SessionStateOut, QuestionOut,
    AnswerIn, AnswerFeedbackOut, ResultOut, SessionHistoryOut, SessionReviewOut, ReviewQuestionOut,
    TutorRequest, TutorResponse
)
from app.services.quiz import create_session, get_question_for_session, answer_question, compute_result
from app.services.gemini import ask_gemini, GeminiDisabled, GeminiError

router = APIRouter(prefix="/api", tags=["api"])

@router.get("/health")
def health():
    ai_enabled = bool(settings.gemini_enable and settings.gemini_api_key and settings.gemini_api_key.strip())
    return {"ok": True, "ai_enabled": ai_enabled, "ai_model": settings.gemini_model}

@router.get("/exams", response_model=list[ExamOut])
def list_exams(db: Session = Depends(get_db)):
    exams = db.execute(select(Exam).order_by(Exam.title.asc())).scalars().all()
    return [ExamOut(id=e.id, title=e.title, source=e.source, question_count=e.question_count) for e in exams]

@router.post("/sessions", response_model=SessionOut)
def start_session(payload: CreateSessionIn, db: Session = Depends(get_db)):
    try:
        session = create_session(db, payload.exam_id, payload.total_questions, payload.question_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return SessionOut(
        id=session.id, exam_id=session.exam_id, total_questions=session.total_questions,
        current_index=session.current_index, correct_count=session.correct_count, wrong_count=session.wrong_count
    )

def _iso(dt):
    return dt.isoformat() if dt else None

@router.get("/sessions/history", response_model=list[SessionHistoryOut])
def get_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    stmt = (
        select(ExamSession, Exam.title)
        .outerjoin(Exam, Exam.id == ExamSession.exam_id)
        .where(ExamSession.completed_at.is_not(None))
        .order_by(ExamSession.completed_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    history = []
    for session, exam_title in rows:
        total = session.total_questions
        score = (session.correct_count / total * 100.0) if total else 0.0
        history.append(SessionHistoryOut(
            id=session.id,
            exam_id=session.exam_id,
            exam_title=exam_title,
            created_at=_iso(session.created_at),
            completed_at=_iso(session.completed_at),
            total_questions=total,
            correct_count=session.correct_count,
            wrong_count=session.wrong_count,
            score_percent=round(score, 2)
        ))
    return history

def _get_session(db: Session, session_id: str) -> ExamSession:
    session = db.get(ExamSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@router.get("/sessions/{session_id}", response_model=SessionStateOut)
def get_session_state(session_id: str, db: Session = Depends(get_db)):
    session = _get_session(db, session_id)
    return SessionStateOut(
        id=session.id,
        exam_id=session.exam_id,
        total_questions=session.total_questions,
        current_index=session.current_index,
        correct_count=session.correct_count,
        wrong_count=session.wrong_count,
        finished=session.completed_at is not None
    )

@router.get("/sessions/{session_id}/next")
def get_next_question(session_id: str, db: Session = Depends(get_db)):
    session = _get_session(db, session_id)
    q = get_question_for_session(db, session, session.current_index)
    if q is None:
        return {"finished": True}
    return {"finished": False, "question": q, "progress_index": session.current_index, "total_questions": session.total_questions}

@router.post("/sessions/{session_id}/answer", response_model=AnswerFeedbackOut)
def submit_answer(session_id: str, payload: AnswerIn, db: Session = Depends(get_db)):
    session = _get_session(db, session_id)
    try:
        fb = answer_question(db, session, payload.question_id, payload.selected_keys)
        return AnswerFeedbackOut(**fb)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/sessions/{session_id}/result", response_model=ResultOut)
def get_result(session_id: str, db: Session = Depends(get_db)):
    session = _get_session(db, session_id)
    return ResultOut(**compute_result(db, session))

@router.get("/sessions/{session_id}/review", response_model=SessionReviewOut)
def get_review(session_id: str, db: Session = Depends(get_db)):
    session = _get_session(db, session_id)
    if session.completed_at is None:
        raise HTTPException(status_code=400, detail="Session not completed.")
    exam = db.get(Exam, session.exam_id) if session.exam_id else None
    total = session.total_questions
    score = (session.correct_count / total * 100.0) if total else 0.0
    session_meta = SessionHistoryOut(
        id=session.id,
        exam_id=session.exam_id,
        exam_title=exam.title if exam else None,
        created_at=_iso(session.created_at),
        completed_at=_iso(session.completed_at),
        total_questions=total,
        correct_count=session.correct_count,
        wrong_count=session.wrong_count,
        score_percent=round(score, 2)
    )

    q_rows = db.execute(
        select(
            SessionQuestion.position,
            Question.id,
            Question.prompt,
            Question.multi_select,
            Question.domain,
            Question.difficulty,
            Question.certification,
            Question.tags_json,
        )
        .join(Question, Question.id == SessionQuestion.question_id)
        .where(SessionQuestion.session_id == session.id)
        .order_by(SessionQuestion.position.asc())
    ).all()
    qids = [row[1] for row in q_rows]

    opt_rows = []
    exp_rows = []
    ans_rows = []
    if qids:
        opt_rows = db.execute(
            select(Option.question_id, Option.key, Option.text, Option.is_correct)
            .where(Option.question_id.in_(qids))
            .order_by(Option.question_id.asc(), Option.key.asc())
        ).all()
        exp_rows = db.execute(
            select(Explanation.question_id, Explanation.justification)
            .where(Explanation.question_id.in_(qids))
        ).all()
        ans_rows = db.execute(
            select(SessionAnswer.question_id, SessionAnswer.selected_keys, SessionAnswer.is_correct)
            .where(SessionAnswer.session_id == session.id)
        ).all()

    opt_map = {}
    for qid, key, text, is_correct in opt_rows:
        opt_map.setdefault(qid, []).append({"key": key, "text": text, "is_correct": is_correct})

    exp_map = {qid: just for (qid, just) in exp_rows}
    ans_map = {qid: {"selected_keys": (sel.split(",") if sel else []), "is_correct": ok} for (qid, sel, ok) in ans_rows}

    questions = []
    for _pos, qid, prompt, multi, domain, difficulty, certification, tags_json in q_rows:
        opts = opt_map.get(qid, [])
        correct_keys = [o["key"] for o in opts if o["is_correct"]]
        ans = ans_map.get(qid, {})
        tags = None
        if tags_json:
            try:
                parsed_tags = json.loads(tags_json)
                if isinstance(parsed_tags, list):
                    tags = [str(tag).strip() for tag in parsed_tags if str(tag).strip()]
            except (TypeError, ValueError):
                tags = None
        questions.append(ReviewQuestionOut(
            id=qid,
            prompt=prompt,
            multi_select=multi,
            domain=domain,
            difficulty=difficulty,
            certification=certification,
            options=[{"key": o["key"], "text": o["text"]} for o in opts],
            correct_keys=correct_keys,
            selected_keys=ans.get("selected_keys", []),
            is_correct=ans.get("is_correct"),
            justification=exp_map.get(qid),
            tags=tags
        ))

    return SessionReviewOut(
        session=session_meta,
        result=ResultOut(**compute_result(db, session)),
        questions=questions
    )

@router.post("/sessions/{session_id}/questions/{question_id}/tutor", response_model=TutorResponse)
def tutor_question(session_id: str, question_id: str, payload: TutorRequest, db: Session = Depends(get_db)):
    _ = _get_session(db, session_id)

    belongs = db.execute(
        select(SessionQuestion.id).where(
            SessionQuestion.session_id == session_id,
            SessionQuestion.question_id == question_id
        )
    ).scalar_one_or_none()
    if not belongs:
        raise HTTPException(status_code=400, detail="Question does not belong to this session.")

    q = db.get(Question, question_id)
    if not q:
        raise HTTPException(status_code=404, detail="Question not found.")

    mode = (payload.mode or "help").strip().lower()
    allowed_modes = {"help", "why_wrong", "review"}
    if mode not in allowed_modes:
        raise HTTPException(status_code=400, detail="Invalid mode.")

    user_message = (payload.user_message or "").strip()
    if len(user_message) > 800:
        raise HTTPException(status_code=400, detail="Message too long.")
    if not user_message:
        if mode == "help":
            user_message = "Me ajude a entender esta questao e os conceitos envolvidos."
        elif mode == "why_wrong":
            user_message = "Explique por que minha resposta esta errada e como evitar esse erro."
        else:
            user_message = "Revisar a materia relacionada a esta questao."

    opt_rows = db.execute(
        select(Option.key, Option.text, Option.is_correct)
        .where(Option.question_id == question_id)
        .order_by(Option.key.asc())
    ).all()
    options = [{"key": k, "text": t, "is_correct": ok} for (k, t, ok) in opt_rows]

    ans = db.execute(
        select(SessionAnswer.selected_keys, SessionAnswer.is_correct)
        .where(SessionAnswer.session_id == session_id, SessionAnswer.question_id == question_id)
    ).first()
    selected_keys = []
    is_correct = None
    if ans:
        selected_raw, ok = ans
        selected_keys = [k for k in (selected_raw.split(",") if selected_raw else []) if k]
        is_correct = bool(ok)

    exp = db.get(Explanation, question_id)

    if mode == "why_wrong":
        if is_correct is None:
            return TutorResponse(
                message="Voce ainda nao respondeu essa questao. Responda e depois use 'Pq Errei!' para analisar o erro.",
                blocked=True,
                model=settings.gemini_model,
            )
        if is_correct is True:
            return TutorResponse(
                message="Sua resposta esta correta. Posso revisar o conceito ou tirar outras duvidas sobre a questao.",
                blocked=False,
                model=settings.gemini_model,
            )

    try:
        result = ask_gemini(
            question_prompt=q.prompt,
            options=options,
            multi_select=q.multi_select,
            user_message=user_message,
            mode=mode,
            selected_keys=selected_keys,
            is_correct=is_correct,
            justification=exp.justification if exp else None,
        )
    except GeminiDisabled:
        raise HTTPException(status_code=503, detail="Gemini disabled. Configure GEMINI_API_KEY.")
    except GeminiError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return TutorResponse(message=result.message, blocked=result.blocked, model=result.model)
