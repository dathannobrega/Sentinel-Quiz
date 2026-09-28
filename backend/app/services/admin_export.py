"""Streaming JSON export of the database (moved out of api/admin.py).

The export used to load every table into memory and build one giant string. It is
now produced incrementally: rows are read in batches (``yield_per``) with a
dedicated short-lived session and serialised chunk by chunk, so memory stays flat
regardless of the database size. The JSON document has the same structure/keys as
before (only whitespace differs).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    DomainBlueprint,
    DomainCatalog,
    EditorialAuditLog,
    Exam,
    ExamSession,
    Explanation,
    ImportState,
    Option,
    Question,
    QuestionBank,
    QuestionReference,
    QuestionStatsSnapshot,
    QuestionVersion,
    QuestionVersionOption,
    SessionAnswer,
    SessionQuestion,
    UserDomainMetricDaily,
    UserExamMetricsSnapshot,
    WeeklyProgressSnapshot,
)
from app.services.admin_serialization import iso_or_none, parse_dict_list, parse_json, parse_text_list


logger = logging.getLogger("app.admin.export")

EXPORT_BATCH_SIZE = 500
EXPORT_FORMAT_VERSION = "1.0.0"


_iso = iso_or_none
_parse_str_list = parse_text_list
_parse_dict_list = parse_dict_list
_parse_json = parse_json


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_array(items: Iterable[Any]) -> Iterator[str]:
    yield "["
    first = True
    for item in items:
        if not first:
            yield ","
        first = False
        yield _dumps(item)
    yield "]"


def _batches(db: Session, stmt) -> Iterator[list]:
    result = db.execute(stmt.execution_options(yield_per=EXPORT_BATCH_SIZE))
    for partition in result.scalars().partitions(EXPORT_BATCH_SIZE):
        yield list(partition)


def _rows(db: Session, stmt, serializer: Callable[[Any], Dict[str, Any]]) -> Iterator[Dict[str, Any]]:
    for batch in _batches(db, stmt):
        for row in batch:
            yield serializer(row)


# --------------------------------------------------------------------------- exams
def _serialize_questions(db: Session, questions: List[Question]) -> Iterator[Dict[str, Any]]:
    qids = [q.id for q in questions]
    opt_map: Dict[str, List[Option]] = {}
    for opt in db.execute(select(Option).where(Option.question_id.in_(qids))).scalars().all():
        opt_map.setdefault(opt.question_id, []).append(opt)
    exp_map = {
        exp.question_id: exp
        for exp in db.execute(select(Explanation).where(Explanation.question_id.in_(qids))).scalars().all()
    }
    for q in questions:
        q_opts = sorted(opt_map.get(q.id, []), key=lambda o: o.key)
        explanation = exp_map.get(q.id)
        yield {
            "id": q.id,
            "exam_id": q.exam_id,
            "prompt": q.prompt,
            "multi_select": q.multi_select,
            "domain": q.domain,
            "difficulty": q.difficulty,
            "certification": q.certification,
            "tags": _parse_str_list(q.tags_json),
            "citations": _parse_dict_list(q.citations_json),
            "options": [{"key": o.key, "text": o.text, "is_correct": o.is_correct} for o in q_opts],
            "correct_keys": [o.key for o in q_opts if o.is_correct],
            "justification": explanation.justification if explanation else None,
        }


def _exam_questions(db: Session, exam_id: str) -> Iterator[Dict[str, Any]]:
    stmt = select(Question).where(Question.exam_id == exam_id).order_by(Question.id.asc())
    for batch in _batches(db, stmt):
        yield from _serialize_questions(db, batch)


def _exam_object(header: Dict[str, Any], questions: Iterator[Dict[str, Any]]) -> Iterator[str]:
    head = _dumps(header)
    # Re-open the object to append the streamed "questions" array as the last key.
    yield head[:-1] + ',"questions":'
    yield from _json_array(questions)
    yield "}"


def _iter_exams(db: Session) -> Iterator[str]:
    yield "["
    first = True
    known_exam_ids = set()
    exams = db.execute(select(Exam.id, Exam.title, Exam.source, Exam.question_count).order_by(Exam.title.asc())).all()
    for exam_id, title, source, question_count in exams:
        known_exam_ids.add(exam_id)
        if not first:
            yield ","
        first = False
        yield from _exam_object(
            {"id": exam_id, "title": title, "source": source, "question_count": question_count},
            _exam_questions(db, exam_id),
        )

    # Questions whose exam row is missing are grouped under a synthetic exam entry.
    orphan_exam_ids = [
        exam_id
        for (exam_id,) in db.execute(select(Question.exam_id).distinct().order_by(Question.exam_id.asc())).all()
        if exam_id not in known_exam_ids
    ]
    for exam_id in orphan_exam_ids:
        if not first:
            yield ","
        first = False
        yield from _exam_object(
            {"id": exam_id, "title": exam_id, "source": None, "question_count": None},
            _exam_questions(db, exam_id),
        )
    yield "]"


# ------------------------------------------------------------------------ editorial
def _iter_versions(db: Session) -> Iterator[Dict[str, Any]]:
    stmt = select(QuestionVersion).order_by(QuestionVersion.question_bank_id.asc(), QuestionVersion.version_number.asc())
    for batch in _batches(db, stmt):
        version_ids = [version.id for version in batch]
        option_map: Dict[int, List[QuestionVersionOption]] = {}
        for item in db.execute(
            select(QuestionVersionOption)
            .where(QuestionVersionOption.version_id.in_(version_ids))
            .order_by(QuestionVersionOption.version_id.asc(), QuestionVersionOption.key.asc())
        ).scalars().all():
            option_map.setdefault(item.version_id, []).append(item)
        reference_map: Dict[int, List[QuestionReference]] = {}
        for item in db.execute(
            select(QuestionReference)
            .where(QuestionReference.question_version_id.in_(version_ids))
            .order_by(QuestionReference.question_version_id.asc(), QuestionReference.id.asc())
        ).scalars().all():
            reference_map.setdefault(item.question_version_id, []).append(item)

        for version in batch:
            yield {
                "id": version.id,
                "question_id": version.question_bank_id,
                "version_number": version.version_number,
                "status": version.status,
                "exam_id": version.exam_id,
                "prompt": version.prompt,
                "multi_select": version.multi_select,
                "domain": version.domain,
                "difficulty": version.difficulty,
                "certification": version.certification,
                "subject": version.subject,
                "subtopic": version.subtopic,
                "subdomain": version.subdomain,
                "objective_code": version.objective_code,
                "blueprint_code": version.blueprint_code,
                "keywords": _parse_str_list(version.keywords_json),
                "trap_patterns": _parse_str_list(version.trap_patterns_json),
                "question_format": version.question_format,
                "tags": _parse_str_list(version.tags_json),
                "citations": [
                    {
                        "source": ref.source,
                        "reference": ref.reference,
                        "chapter": ref.chapter,
                        "locator": ref.locator,
                        "material_path": ref.material_path,
                        "page_start": ref.page_start,
                        "page_end": ref.page_end,
                    }
                    for ref in reference_map.get(version.id, [])
                ] or _parse_dict_list(version.citations_json),
                "options": [
                    {"key": option.key, "text": option.text, "is_correct": option.is_correct}
                    for option in option_map.get(version.id, [])
                ],
                "justification": version.justification,
                "correct_rationale": version.correct_rationale,
                "incorrect_rationales": _parse_str_list(version.incorrect_rationales_json),
                "avg_time_seconds": version.avg_time_seconds,
                "global_accuracy_percent": version.global_accuracy_percent,
                "change_summary": version.change_summary,
                "review_notes": version.review_notes,
                "created_by_user_id": version.created_by_user_id,
                "updated_by_user_id": version.updated_by_user_id,
                "approved_by_user_id": version.approved_by_user_id,
                "created_at": _iso(version.created_at),
                "updated_at": _iso(version.updated_at),
                "published_at": _iso(version.published_at),
            }


def _serialize_bank(bank: QuestionBank) -> Dict[str, Any]:
    return {
        "question_id": bank.stable_question_id,
        "published_version_id": bank.published_version_id,
        "draft_version_id": bank.draft_version_id,
        "review_status": bank.review_status,
        "created_by_user_id": bank.created_by_user_id,
        "updated_by_user_id": bank.updated_by_user_id,
        "created_at": _iso(bank.created_at),
        "updated_at": _iso(bank.updated_at),
    }


def _serialize_audit(item: EditorialAuditLog) -> Dict[str, Any]:
    return {
        "id": item.id,
        "question_id": item.question_bank_id,
        "question_version_id": item.question_version_id,
        "actor_user_id": item.actor_user_id,
        "actor_role": item.actor_role,
        "action": item.action,
        "reason": item.reason,
        "metadata": _parse_json(item.metadata_json, None),
        "created_at": _iso(item.created_at),
    }


def _serialize_stats_snapshot(item: QuestionStatsSnapshot) -> Dict[str, Any]:
    return {
        "id": item.id,
        "capture_batch_id": item.capture_batch_id,
        "question_id": item.question_id,
        "question_version_id": item.question_version_id,
        "exam_id": item.exam_id,
        "domain": item.domain,
        "certification": item.certification,
        "attempts_total": item.attempts_total,
        "exam_attempts": item.exam_attempts,
        "study_attempts": item.study_attempts,
        "wrong_count": item.wrong_count,
        "wrong_rate_percent": item.wrong_rate_percent,
        "low_confidence_count": item.low_confidence_count,
        "low_confidence_rate_percent": item.low_confidence_rate_percent,
        "review_pressure_count": item.review_pressure_count,
        "avg_study_elapsed_seconds": item.avg_study_elapsed_seconds,
        "difficulty_score": item.difficulty_score,
        "captured_at": _iso(item.captured_at),
    }


def _serialize_domain_catalog(item: DomainCatalog) -> Dict[str, Any]:
    return {
        "id": item.id,
        "certification": item.certification,
        "domain": item.domain,
        "subdomain": item.subdomain,
        "subject": item.subject,
        "objective_code": item.objective_code,
        "blueprint_code": item.blueprint_code,
        "title": item.title,
        "description": item.description,
        "is_active": item.is_active,
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def _serialize_domain_blueprint(item: DomainBlueprint) -> Dict[str, Any]:
    return {
        "id": item.id,
        "certification": item.certification,
        "blueprint_code": item.blueprint_code,
        "objective_code": item.objective_code,
        "domain": item.domain,
        "subdomain": item.subdomain,
        "title": item.title,
        "description": item.description,
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


# ------------------------------------------------------------------------- sessions
def _iter_sessions(db: Session) -> Iterator[Dict[str, Any]]:
    stmt = select(ExamSession).order_by(ExamSession.created_at.asc(), ExamSession.id.asc())
    for batch in _batches(db, stmt):
        session_ids = [session.id for session in batch]
        sq_map: Dict[str, List[SessionQuestion]] = {}
        for sq in db.execute(select(SessionQuestion).where(SessionQuestion.session_id.in_(session_ids))).scalars().all():
            sq_map.setdefault(sq.session_id, []).append(sq)
        sa_map: Dict[str, List[SessionAnswer]] = {}
        for sa in db.execute(select(SessionAnswer).where(SessionAnswer.session_id.in_(session_ids))).scalars().all():
            sa_map.setdefault(sa.session_id, []).append(sa)

        for s in batch:
            q_list = sorted(sq_map.get(s.id, []), key=lambda row: row.position)
            a_list = sorted(sa_map.get(s.id, []), key=lambda row: row.answered_at or datetime.min)
            yield {
                "id": s.id,
                "exam_id": s.exam_id,
                "created_at": _iso(s.created_at),
                "total_questions": s.total_questions,
                "current_index": s.current_index,
                "correct_count": s.correct_count,
                "wrong_count": s.wrong_count,
                "completed_at": _iso(s.completed_at),
                "questions": [{"position": q.position, "question_id": q.question_id} for q in q_list],
                "answers": [
                    {
                        "question_id": a.question_id,
                        "selected_keys": a.selected_keys.split(",") if a.selected_keys else [],
                        "is_correct": a.is_correct,
                        "answered_at": _iso(a.answered_at),
                    }
                    for a in a_list
                ],
            }


# ---------------------------------------------------------------------- learning
def _serialize_domain_metric(item: UserDomainMetricDaily) -> Dict[str, Any]:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "client_key": item.client_key,
        "metric_date": _iso(item.metric_date),
        "exam_id": item.exam_id,
        "certification": item.certification,
        "domain": item.domain,
        "attempts_total": item.attempts_total,
        "exam_attempts": item.exam_attempts,
        "study_attempts": item.study_attempts,
        "correct_count": item.correct_count,
        "wrong_count": item.wrong_count,
        "low_confidence_count": item.low_confidence_count,
        "total_elapsed_seconds": item.total_elapsed_seconds,
        "timed_attempts": item.timed_attempts,
        "updated_at": _iso(item.updated_at),
    }


def _serialize_exam_metric(item: UserExamMetricsSnapshot) -> Dict[str, Any]:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "client_key": item.client_key,
        "session_id": item.session_id,
        "mode": item.mode,
        "exam_id": item.exam_id,
        "selection_strategy": item.selection_strategy,
        "total_questions": item.total_questions,
        "answered_count": item.answered_count,
        "correct_count": item.correct_count,
        "wrong_count": item.wrong_count,
        "score_percent": item.score_percent,
        "duration_seconds": item.duration_seconds,
        "weakest_domains": _parse_json(item.weakest_domains_json, []),
        "review_due_count": item.review_due_count,
        "review_total_count": item.review_total_count,
        "completed_at": _iso(item.completed_at),
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def _serialize_weekly(item: WeeklyProgressSnapshot) -> Dict[str, Any]:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "client_key": item.client_key,
        "week_start": _iso(item.week_start),
        "questions_answered": item.questions_answered,
        "review_questions": item.review_questions,
        "scheduled_reviews": item.scheduled_reviews,
        "correct_count": item.correct_count,
        "wrong_count": item.wrong_count,
        "low_confidence_count": item.low_confidence_count,
        "completed_exam_sessions": item.completed_exam_sessions,
        "completed_study_sessions": item.completed_study_sessions,
        "completed_review_sessions": item.completed_review_sessions,
        "review_due_count": item.review_due_count,
        "review_total_count": item.review_total_count,
        "updated_at": _iso(item.updated_at),
    }


def _serialize_import(item: ImportState) -> Dict[str, Any]:
    return {"file_name": item.file_name, "file_sha256": item.file_sha256, "imported_at": _iso(item.imported_at)}


# ------------------------------------------------------------------------ document
def iter_export_document(db: Session, *, exported_at: Optional[datetime] = None) -> Iterator[str]:
    meta = {"exported_at": (exported_at or datetime.utcnow()).isoformat(), "version": EXPORT_FORMAT_VERSION}
    yield '{"meta":' + _dumps(meta)

    yield ',"exams":'
    yield from _iter_exams(db)

    yield ',"editorial":{"question_banks":'
    yield from _json_array(_rows(db, select(QuestionBank).order_by(QuestionBank.stable_question_id.asc()), _serialize_bank))
    yield ',"versions":'
    yield from _json_array(_iter_versions(db))
    yield ',"audit_log":'
    yield from _json_array(
        _rows(db, select(EditorialAuditLog).order_by(EditorialAuditLog.created_at.desc()), _serialize_audit)
    )
    yield ',"question_stats_snapshots":'
    yield from _json_array(
        _rows(
            db,
            select(QuestionStatsSnapshot).order_by(QuestionStatsSnapshot.captured_at.desc(), QuestionStatsSnapshot.id.desc()),
            _serialize_stats_snapshot,
        )
    )
    yield ',"domain_catalog":'
    yield from _json_array(
        _rows(
            db,
            select(DomainCatalog).order_by(DomainCatalog.certification.asc(), DomainCatalog.domain.asc(), DomainCatalog.id.asc()),
            _serialize_domain_catalog,
        )
    )
    yield ',"domain_blueprints":'
    yield from _json_array(
        _rows(
            db,
            select(DomainBlueprint).order_by(
                DomainBlueprint.certification.asc(), DomainBlueprint.blueprint_code.asc(), DomainBlueprint.id.asc()
            ),
            _serialize_domain_blueprint,
        )
    )
    yield "}"

    yield ',"sessions":'
    yield from _json_array(_iter_sessions(db))

    yield ',"learning_metrics":{"user_domain_metrics_daily":'
    yield from _json_array(
        _rows(
            db,
            select(UserDomainMetricDaily).order_by(UserDomainMetricDaily.metric_date.desc(), UserDomainMetricDaily.id.desc()),
            _serialize_domain_metric,
        )
    )
    yield ',"user_exam_metrics_snapshot":'
    yield from _json_array(
        _rows(
            db,
            select(UserExamMetricsSnapshot).order_by(
                UserExamMetricsSnapshot.completed_at.desc(), UserExamMetricsSnapshot.id.desc()
            ),
            _serialize_exam_metric,
        )
    )
    yield ',"weekly_progress_snapshot":'
    yield from _json_array(
        _rows(
            db,
            select(WeeklyProgressSnapshot).order_by(WeeklyProgressSnapshot.week_start.desc(), WeeklyProgressSnapshot.id.desc()),
            _serialize_weekly,
        )
    )
    yield "}"

    yield ',"import_state":'
    yield from _json_array(_rows(db, select(ImportState).order_by(ImportState.imported_at.desc()), _serialize_import))
    yield "}"


def stream_export(session_factory: Callable[[], Session]) -> Iterator[bytes]:
    """Yield the export as UTF-8 chunks using a dedicated session (closed at the end)."""
    db = session_factory()
    buffer: List[str] = []
    buffered = 0
    try:
        for chunk in iter_export_document(db):
            buffer.append(chunk)
            buffered += len(chunk)
            if buffered >= 64 * 1024:
                yield "".join(buffer).encode("utf-8")
                buffer, buffered = [], 0
        if buffer:
            yield "".join(buffer).encode("utf-8")
    except Exception:
        logger.exception("Database export failed while streaming", extra={"event": "admin_export_failed"})
        raise
    finally:
        db.rollback()
        db.close()


def export_filename(now: Optional[datetime] = None) -> str:
    return f"securityplus_export_{(now or datetime.utcnow()).strftime('%Y%m%d_%H%M%S')}.json"
