from __future__ import annotations

import json
from html import escape
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.api.deps import get_current_user_optional, get_client_key
from app.db.session import get_db
from app.core.config import settings
from app.models import Exam, ExamSession, SessionQuestion, SessionAnswer, Question, Option, Explanation, User
from app.schemas import (
    ExamOut, CreateSessionIn, SessionOut, SessionStateOut, QuestionOut,
    AnswerIn, AnswerFeedbackOut, ResultOut, SessionHistoryOut, SessionReviewOut, ReviewQuestionOut,
    EngagementSnapshotOut, TutorRequest, TutorResponse
)
from app.services.engagement import build_engagement_snapshot
from app.services.quiz import (
    create_session,
    get_question_for_session,
    answer_question,
    compute_result,
    build_domain_catalog,
    build_weak_area_snapshot_for_owner,
    pause_exam_session,
    resume_exam_session,
    serialize_exam_session,
    sync_exam_session_state,
)
from app.services.gemini import ask_gemini, GeminiDisabled, GeminiError
from app.services.materials import build_material_preview

router = APIRouter(prefix="/api", tags=["api"])

@router.get("/health")
def health():
    ai_enabled = bool(settings.gemini_enable and settings.gemini_api_key and settings.gemini_api_key.strip())
    return {"ok": True, "ai_enabled": ai_enabled, "ai_model": settings.gemini_model}

@router.get("/exams", response_model=list[ExamOut])
def list_exams(db: Session = Depends(get_db)):
    exams = db.execute(select(Exam).order_by(Exam.title.asc())).scalars().all()
    return [ExamOut(id=e.id, title=e.title, source=e.source, question_count=e.question_count) for e in exams]


@router.get("/domains")
def list_domains(exam_id: str | None = Query(default=None), db: Session = Depends(get_db)):
    normalized_exam_id = exam_id.strip() if exam_id else None
    return build_domain_catalog(db, normalized_exam_id or None)


@router.get("/analytics/weak-areas")
def weak_area_snapshot(
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    return build_weak_area_snapshot_for_owner(
        db,
        owner_user_id=current_user.id if current_user else None,
        owner_client_key=None if current_user else client_key,
    )


@router.get("/analytics/engagement", response_model=EngagementSnapshotOut)
def engagement_snapshot(
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    if not current_user and not client_key:
        raise HTTPException(status_code=400, detail="Engagement analytics require authentication or X-Client-Key.")
    payload = build_engagement_snapshot(
        db,
        owner_user_id=current_user.id if current_user else None,
        owner_client_key=None if current_user else client_key,
    )
    db.commit()
    return EngagementSnapshotOut(**payload)


@router.post("/sessions", response_model=SessionOut)
def start_session(
    payload: CreateSessionIn,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    if not current_user and not client_key:
        raise HTTPException(
            status_code=400,
            detail="Anonymous sessions require the X-Client-Key header.",
        )
    try:
        session = create_session(
            db,
            payload.exam_id,
            payload.total_questions,
            None,
            payload.domains,
            payload.difficulties,
            payload.tags,
            payload.bookmarked_only,
            payload.notes_only,
            payload.incorrect_only,
            payload.unseen_only,
            payload.low_confidence_only,
            payload.strategy,
            payload.time_limit_minutes,
            owner_user_id=current_user.id if current_user else None,
            owner_client_key=None if current_user else client_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return SessionOut(**serialize_exam_session(session))

def _iso(dt):
    return dt.isoformat() if dt else None


def _selection_mix(selection_mix_json: str | None) -> dict:
    if not selection_mix_json:
        return {}
    try:
        payload = json.loads(selection_mix_json)
    except (TypeError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    raw_mix = payload.get("_selection_mix") if isinstance(payload.get("_selection_mix"), dict) else payload
    if not isinstance(raw_mix, dict):
        return {}
    cleaned = {}
    for key, value in raw_mix.items():
        label = str(key or "").strip()
        if not label or label.startswith("_"):
            continue
        try:
            cleaned[label] = max(int(value), 0)
        except (TypeError, ValueError):
            continue
    return cleaned


def _scope_session_history(stmt, current_user: User | None, client_key: str | None):
    if current_user:
        return stmt.where(ExamSession.user_id == current_user.id)
    if client_key:
        return stmt.where(ExamSession.user_id.is_(None), ExamSession.client_key == client_key)
    return stmt.where(False)

@router.get("/sessions/history", response_model=list[SessionHistoryOut])
def get_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
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
    stmt = _scope_session_history(stmt, current_user, client_key)
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
            selection_strategy=session.selection_strategy or "standard",
            selection_mix=_selection_mix(session.selection_mix_json),
            total_questions=total,
            correct_count=session.correct_count,
            wrong_count=session.wrong_count,
            score_percent=round(score, 2)
        ))
    return history


def _get_session(
    db: Session,
    session_id: str,
    current_user: User | None = None,
    client_key: str | None = None,
) -> ExamSession:
    session = db.get(ExamSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id:
        if not current_user or session.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Session not found")
    elif session.client_key:
        if not client_key or session.client_key != client_key:
            raise HTTPException(status_code=404, detail="Session not found")
    return session

@router.get("/sessions/{session_id}", response_model=SessionStateOut)
def get_session_state(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    sync_exam_session_state(db, session)
    return SessionStateOut(**serialize_exam_session(session))

@router.get("/sessions/{session_id}/next")
def get_next_question(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    sync_exam_session_state(db, session)
    if session.completed_at is not None:
        return {"finished": True}
    q = get_question_for_session(db, session, session.current_index)
    if q is None:
        return {"finished": True}
    return {"finished": False, "question": q, "progress_index": session.current_index, "total_questions": session.total_questions}


@router.post("/sessions/{session_id}/pause", response_model=SessionStateOut)
def pause_session(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    try:
        updated = pause_exam_session(db, session)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return SessionStateOut(**serialize_exam_session(updated))


@router.post("/sessions/{session_id}/resume", response_model=SessionStateOut)
def resume_session(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    try:
        updated = resume_exam_session(db, session)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return SessionStateOut(**serialize_exam_session(updated))

@router.post("/sessions/{session_id}/answer", response_model=AnswerFeedbackOut)
def submit_answer(
    session_id: str,
    payload: AnswerIn,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    try:
        fb = answer_question(db, session, payload.question_id, payload.selected_keys)
        return AnswerFeedbackOut(**fb)
    except ValueError as e:
        detail = str(e)
        if "auto-submitted" in detail or "paused" in detail.lower():
            raise HTTPException(status_code=409, detail=detail)
        raise HTTPException(status_code=400, detail=detail)

@router.get("/sessions/{session_id}/result", response_model=ResultOut)
def get_result(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    sync_exam_session_state(db, session)
    result = ResultOut(**compute_result(db, session))
    db.commit()
    return result

@router.get("/sessions/{session_id}/review", response_model=SessionReviewOut)
def get_review(
    session_id: str,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id, current_user, client_key)
    sync_exam_session_state(db, session)
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
        selection_strategy=session.selection_strategy or "standard",
        selection_mix=_selection_mix(session.selection_mix_json),
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
            Question.citations_json,
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
    for _pos, qid, prompt, multi, domain, difficulty, certification, tags_json, citations_json in q_rows:
        opts = opt_map.get(qid, [])
        correct_keys = [o["key"] for o in opts if o["is_correct"]]
        ans = ans_map.get(qid, {})
        tags = None
        citations = None
        if tags_json:
            try:
                parsed_tags = json.loads(tags_json)
                if isinstance(parsed_tags, list):
                    tags = [str(tag).strip() for tag in parsed_tags if str(tag).strip()]
            except (TypeError, ValueError):
                tags = None
        if citations_json:
            try:
                parsed_citations = json.loads(citations_json)
                if isinstance(parsed_citations, list):
                    citations = [item for item in parsed_citations if isinstance(item, dict)]
            except (TypeError, ValueError):
                citations = None
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
            tags=tags,
            citations=citations,
        ))

    response = SessionReviewOut(
        session=session_meta,
        result=ResultOut(**compute_result(db, session)),
        questions=questions
    )
    db.commit()
    return response


@router.get("/materials/preview", response_class=HTMLResponse)
def material_preview(
    material_path: str = Query(...),
    locator: str | None = Query(default=None),
    page_start: str | None = Query(default=None),
    page_end: str | None = Query(default=None),
):
    try:
        preview = build_material_preview(material_path, locator)
    except FileNotFoundError:
        return HTMLResponse(
            "<html><body><h1>Material nao encontrado</h1><p>Verifique se o arquivo existe no servidor.</p></body></html>",
            status_code=404,
        )
    except Exception:
        return HTMLResponse(
            "<html><body><h1>Nao foi possivel abrir o material</h1><p>O preview deste arquivo falhou.</p></body></html>",
            status_code=500,
        )

    page_label = ""
    if page_start and page_end and page_start != page_end:
        page_label = f"pp. {page_start}-{page_end}"
    elif page_start:
        page_label = f"p. {page_start}"

    subtitle_parts = [preview.get("chapter"), page_label, preview.get("locator")]
    subtitle = " | ".join([str(part).strip() for part in subtitle_parts if str(part or "").strip()])

    download_html = ""
    download_url = preview.get("download_url")
    if download_url:
        download_html = (
            f'<a href="{escape(download_url)}" target="_blank" rel="noopener noreferrer">Baixar/abrir arquivo original</a>'
        )

    title = escape(str(preview.get("title") or "Preview de material"))
    subtitle_html = escape(str(subtitle or preview.get("material_name") or ""))
    body_html = str(preview.get("body_html") or "<p>Sem conteudo suficiente.</p>")

    html = f"""<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <style>
    body {{ margin: 0; font-family: Georgia, 'Times New Roman', serif; background: #f5f1e8; color: #1f2937; }}
    main {{ max-width: 920px; margin: 0 auto; padding: 32px 18px 48px; }}
    .eyebrow {{ font: 700 12px/1.4 sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #7c5d2c; }}
    h1 {{ margin: 8px 0 10px; font-size: clamp(26px, 4vw, 40px); line-height: 1.1; }}
    .meta {{ color: #6b7280; font: 500 14px/1.5 sans-serif; }}
    .card {{ margin-top: 22px; background: rgba(255,255,255,.76); border: 1px solid rgba(124,93,44,.14); border-radius: 18px; padding: 22px; box-shadow: 0 16px 40px rgba(31,41,55,.08); }}
    .body p, .body li {{ font-size: 18px; line-height: 1.75; margin: 0 0 16px; }}
    .body ul {{ margin: 0 0 18px 18px; padding: 0; }}
    a {{ color: #0f766e; font: 600 14px/1.4 sans-serif; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Trecho do material</div>
    <h1>{title}</h1>
    <div class="meta">{subtitle_html}</div>
    <div class="meta" style="margin-top:6px;">{download_html}</div>
    <div class="card body">{body_html}</div>
  </main>
</body>
</html>"""
    return HTMLResponse(html)

@router.post("/sessions/{session_id}/questions/{question_id}/tutor", response_model=TutorResponse)
def tutor_question(
    session_id: str,
    question_id: str,
    payload: TutorRequest,
    current_user: User | None = Depends(get_current_user_optional),
    client_key: str | None = Depends(get_client_key),
    db: Session = Depends(get_db),
):
    _ = _get_session(db, session_id, current_user, client_key)

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
