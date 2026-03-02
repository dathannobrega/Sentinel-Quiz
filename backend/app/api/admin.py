from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import select
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import json

from app.core.config import settings
from app.db.session import get_db
from app.models import Exam, Question, Option, Explanation, ImportState, ExamSession, SessionQuestion, SessionAnswer
from app.services.ingest import ingest_questions_from_dir

router = APIRouter(prefix="/api/admin", tags=["admin"])

def require_admin(x_admin_key: Optional[str] = Header(default=None)):
    if not x_admin_key or x_admin_key != settings.admin_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

class AdminCreateExamIn(BaseModel):
    id: str
    title: str
    source: Optional[str] = None
    question_count: Optional[int] = None

class AdminOptionIn(BaseModel):
    key: str
    text: str
    is_correct: Optional[bool] = None

class AdminCreateQuestionIn(BaseModel):
    id: str
    exam_id: str
    prompt: str
    multi_select: bool = False
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    tags: Optional[List[str]] = None
    citations: Optional[List[Dict[str, Any]]] = None
    options: List[AdminOptionIn]
    correct_keys: List[str] = Field(default_factory=list)
    justification: Optional[str] = None

class AdminOptionOut(BaseModel):
    key: str
    text: str
    is_correct: bool

class AdminQuestionOut(BaseModel):
    id: str
    exam_id: str
    prompt: str
    multi_select: bool
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    tags: Optional[List[str]] = None
    citations: Optional[List[Dict[str, Any]]] = None
    options: List[AdminOptionOut]
    correct_keys: List[str]
    justification: Optional[str] = None

class AdminQuestionSummaryOut(BaseModel):
    id: str
    exam_id: str
    prompt: str
    multi_select: bool
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    option_count: int
    correct_count: int

class AdminOverviewOut(BaseModel):
    exam_count: int
    question_count: int
    completed_session_count: int
    question_breakdown: Dict[str, int]

@router.post("/ingest")
def admin_ingest(_: bool = Depends(require_admin), db: Session = Depends(get_db)):
    res = ingest_questions_from_dir(db, settings.question_json_dir)
    return res

@router.get("/overview", response_model=AdminOverviewOut)
def admin_overview(_: bool = Depends(require_admin), db: Session = Depends(get_db)):
    exams = db.execute(select(Exam)).scalars().all()
    questions = db.execute(select(Question)).scalars().all()
    completed_sessions = db.execute(
        select(ExamSession.id).where(ExamSession.completed_at.is_not(None))
    ).scalars().all()

    breakdown: Dict[str, int] = {}
    for q in questions:
        key = q.certification or "Sem certificacao"
        breakdown[key] = breakdown.get(key, 0) + 1

    return AdminOverviewOut(
        exam_count=len(exams),
        question_count=len(questions),
        completed_session_count=len(completed_sessions),
        question_breakdown=breakdown,
    )

@router.post("/exams")
def admin_create_exam(payload: AdminCreateExamIn, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    exam = db.get(Exam, payload.id)
    if not exam:
        exam = Exam(id=payload.id, title=payload.title, source=payload.source, question_count=payload.question_count)
        db.add(exam)
    else:
        exam.title = payload.title
        exam.source = payload.source
        exam.question_count = payload.question_count
    db.commit()
    return {"ok": True, "id": exam.id}

@router.post("/questions")
def admin_create_question(payload: AdminCreateQuestionIn, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    exam_id = payload.exam_id.strip()
    question_id = payload.id.strip()
    prompt = payload.prompt.strip()
    if not db.get(Exam, exam_id):
        raise HTTPException(status_code=400, detail="Exam does not exist. Create exam first.")
    if not question_id:
        raise HTTPException(status_code=400, detail="Question ID is required.")
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    normalized_tags = []
    seen_tags = set()
    for tag in payload.tags or []:
        clean = str(tag or "").strip()
        if not clean:
            continue
        key = clean.lower()
        if key in seen_tags:
            continue
        seen_tags.add(key)
        normalized_tags.append(clean)

    normalized_citations = []
    seen_citations = set()
    for item in payload.citations or []:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "").strip()
        reference = str(item.get("reference") or "").strip()
        if not source and not reference:
            continue
        key = (source.lower(), reference.lower())
        if key in seen_citations:
            continue
        seen_citations.add(key)
        normalized_citations.append({"source": source, "reference": reference})

    q = db.get(Question, question_id)
    tags_json = json.dumps(normalized_tags, ensure_ascii=False) if normalized_tags else None
    citations_json = json.dumps(normalized_citations, ensure_ascii=False) if normalized_citations else None

    normalized_options: List[AdminOptionIn] = []
    seen_option_keys = set()
    for opt in payload.options:
        key = opt.key.strip().upper()
        text = opt.text.strip()
        if not key or not text:
            continue
        if key in seen_option_keys:
            raise HTTPException(status_code=400, detail=f"Duplicate option key: {key}")
        seen_option_keys.add(key)
        normalized_options.append(AdminOptionIn(key=key, text=text, is_correct=opt.is_correct))
    if len(normalized_options) < 2:
        raise HTTPException(status_code=400, detail="At least two valid options are required.")

    if not q:
        q = Question(
            id=question_id,
            exam_id=exam_id,
            prompt=prompt,
            multi_select=payload.multi_select,
            domain=(payload.domain.strip() or None) if payload.domain else None,
            difficulty=(payload.difficulty.strip() or None) if payload.difficulty else None,
            certification=(payload.certification.strip() or None) if payload.certification else None,
            tags_json=tags_json,
            citations_json=citations_json,
        )
        db.add(q)
    else:
        q.exam_id = exam_id
        q.prompt = prompt
        q.multi_select = payload.multi_select
        q.domain = (payload.domain.strip() or None) if payload.domain else None
        q.difficulty = (payload.difficulty.strip() or None) if payload.difficulty else None
        q.certification = (payload.certification.strip() or None) if payload.certification else None
        q.tags_json = tags_json
        q.citations_json = citations_json
        # delete existing options
        for opt in list(q.options):
            db.delete(opt)

    correct_set = {k.strip().upper() for k in payload.correct_keys if k and k.strip()}
    for opt in normalized_options:
        if opt.is_correct:
            correct_set.add(opt.key.strip().upper())
    if not correct_set:
        raise HTTPException(status_code=400, detail="At least one correct option is required.")
    invalid_correct_keys = sorted(correct_set - seen_option_keys)
    if invalid_correct_keys:
        raise HTTPException(status_code=400, detail=f"Correct option not found: {', '.join(invalid_correct_keys)}")

    final_multi_select = bool(payload.multi_select or len(correct_set) > 1)
    q.multi_select = final_multi_select

    for opt in normalized_options:
        db.add(Option(question_id=question_id, key=opt.key, text=opt.text, is_correct=(opt.key in correct_set)))

    exp = db.get(Explanation, question_id)
    if not exp:
        db.add(Explanation(question_id=question_id, justification=(payload.justification.strip() or None) if payload.justification else None))
    else:
        exp.justification = (payload.justification.strip() or None) if payload.justification else None

    db.commit()
    return {"ok": True, "id": q.id}

@router.get("/questions", response_model=List[AdminQuestionSummaryOut])
def admin_list_questions(
    exam_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _: bool = Depends(require_admin),
    db: Session = Depends(get_db)
):
    stmt = select(Question).order_by(Question.id.asc())
    if exam_id:
        stmt = stmt.where(Question.exam_id == exam_id.strip())
    if search:
        term = f"%{search.strip()}%"
        if term != "%%":
            stmt = stmt.where(
                (Question.id.ilike(term)) |
                (Question.prompt.ilike(term)) |
                (Question.domain.ilike(term)) |
                (Question.certification.ilike(term))
            )
    questions = db.execute(stmt.limit(limit)).scalars().all()
    if not questions:
        return []

    qids = [q.id for q in questions]
    opt_rows = db.execute(
        select(Option.question_id, Option.is_correct)
        .where(Option.question_id.in_(qids))
    ).all()
    counts: Dict[str, Dict[str, int]] = {qid: {"option_count": 0, "correct_count": 0} for qid in qids}
    for qid, is_correct in opt_rows:
        counts.setdefault(qid, {"option_count": 0, "correct_count": 0})
        counts[qid]["option_count"] += 1
        if is_correct:
            counts[qid]["correct_count"] += 1

    return [
        AdminQuestionSummaryOut(
            id=q.id,
            exam_id=q.exam_id,
            prompt=q.prompt,
            multi_select=q.multi_select,
            domain=q.domain,
            difficulty=q.difficulty,
            certification=q.certification,
            option_count=counts.get(q.id, {}).get("option_count", 0),
            correct_count=counts.get(q.id, {}).get("correct_count", 0),
        )
        for q in questions
    ]

@router.get("/questions/{question_id}", response_model=AdminQuestionOut)
def admin_get_question(question_id: str, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    q = db.get(Question, question_id)
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    opts = db.execute(
        select(Option.key, Option.text, Option.is_correct)
        .where(Option.question_id == q.id)
        .order_by(Option.key.asc())
    ).all()
    correct = [k for (k, _t, ok) in opts if ok]
    exp = db.get(Explanation, q.id)
    tags = None
    if q.tags_json:
        try:
            parsed_tags = json.loads(q.tags_json)
            if isinstance(parsed_tags, list):
                tags = [str(tag).strip() for tag in parsed_tags if str(tag).strip()]
        except (TypeError, ValueError):
            tags = None
    citations = None
    if q.citations_json:
        try:
            parsed_citations = json.loads(q.citations_json)
            if isinstance(parsed_citations, list):
                citations = [item for item in parsed_citations if isinstance(item, dict)]
        except (TypeError, ValueError):
            citations = None

    return AdminQuestionOut(
        id=q.id,
        exam_id=q.exam_id,
        prompt=q.prompt,
        multi_select=q.multi_select,
        domain=q.domain,
        difficulty=q.difficulty,
        certification=q.certification,
        tags=tags,
        citations=citations,
        options=[AdminOptionOut(key=k, text=t, is_correct=ok) for (k, t, ok) in opts],
        correct_keys=correct,
        justification=exp.justification if exp else None
    )

@router.delete("/questions/{question_id}")
def admin_delete_question(question_id: str, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    q = db.get(Question, question_id)
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    db.delete(q)
    db.commit()
    return {"ok": True, "id": question_id}

def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None

def _parse_tags(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    return [str(item).strip() for item in payload if str(item).strip()]

def _parse_citations(raw: Optional[str]) -> List[Dict[str, Any]]:
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]

def _export_db(db: Session) -> Dict[str, Any]:
    exams = db.execute(select(Exam).order_by(Exam.title.asc())).scalars().all()
    questions = db.execute(select(Question)).scalars().all()
    options = db.execute(select(Option)).scalars().all()
    explanations = db.execute(select(Explanation)).scalars().all()
    imports = db.execute(select(ImportState).order_by(ImportState.imported_at.desc())).scalars().all()

    opt_map: Dict[str, List[Option]] = {}
    for opt in options:
        opt_map.setdefault(opt.question_id, []).append(opt)

    exp_map: Dict[str, Explanation] = {e.question_id: e for e in explanations}

    exam_map: Dict[str, Dict[str, Any]] = {
        e.id: {
            "id": e.id,
            "title": e.title,
            "source": e.source,
            "question_count": e.question_count,
            "questions": []
        } for e in exams
    }

    for q in questions:
        q_opts = sorted(opt_map.get(q.id, []), key=lambda o: o.key)
        correct_keys = [o.key for o in q_opts if o.is_correct]
        exam_map.setdefault(q.exam_id, {
            "id": q.exam_id,
            "title": q.exam_id,
            "source": None,
            "question_count": None,
            "questions": []
        })["questions"].append({
            "id": q.id,
            "exam_id": q.exam_id,
            "prompt": q.prompt,
            "multi_select": q.multi_select,
            "domain": q.domain,
            "difficulty": q.difficulty,
            "certification": q.certification,
            "tags": _parse_tags(q.tags_json),
            "citations": _parse_citations(q.citations_json),
            "options": [{"key": o.key, "text": o.text, "is_correct": o.is_correct} for o in q_opts],
            "correct_keys": correct_keys,
            "justification": exp_map.get(q.id).justification if exp_map.get(q.id) else None,
        })

    sessions = db.execute(select(ExamSession)).scalars().all()
    session_questions = db.execute(select(SessionQuestion)).scalars().all()
    session_answers = db.execute(select(SessionAnswer)).scalars().all()

    sq_map: Dict[str, List[SessionQuestion]] = {}
    for sq in session_questions:
        sq_map.setdefault(sq.session_id, []).append(sq)

    sa_map: Dict[str, List[SessionAnswer]] = {}
    for sa in session_answers:
        sa_map.setdefault(sa.session_id, []).append(sa)

    session_export = []
    for s in sessions:
        q_list = sorted(sq_map.get(s.id, []), key=lambda row: row.position)
        a_list = sorted(sa_map.get(s.id, []), key=lambda row: row.answered_at)
        session_export.append({
            "id": s.id,
            "exam_id": s.exam_id,
            "created_at": _iso(s.created_at),
            "total_questions": s.total_questions,
            "current_index": s.current_index,
            "correct_count": s.correct_count,
            "wrong_count": s.wrong_count,
            "completed_at": _iso(s.completed_at),
            "questions": [{"position": q.position, "question_id": q.question_id} for q in q_list],
            "answers": [{
                "question_id": a.question_id,
                "selected_keys": a.selected_keys.split(",") if a.selected_keys else [],
                "is_correct": a.is_correct,
                "answered_at": _iso(a.answered_at)
            } for a in a_list]
        })

    return {
        "meta": {
            "exported_at": datetime.utcnow().isoformat(),
            "version": "1.0.0"
        },
        "exams": list(exam_map.values()),
        "sessions": session_export,
        "import_state": [{
            "file_name": i.file_name,
            "file_sha256": i.file_sha256,
            "imported_at": _iso(i.imported_at)
        } for i in imports]
    }

@router.get("/export")
def admin_export_db(_: bool = Depends(require_admin), db: Session = Depends(get_db)):
    payload = _export_db(db)
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    filename = f"securityplus_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=body, media_type="application/json", headers=headers)
