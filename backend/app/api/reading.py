"""Sentinel Reader API (``/api/reading/*``, docs/reading/CONTRATO-INCREMENTO-1.md §4).

Signed-in users only (the books are licensed, like ``/api/materials/*``). Text is always resolved
server-side from the corpus: the client names a block, never sends text. The speech service is
optional; its absence degrades ``capabilities`` instead of failing the reader.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_required
from app.core.config import settings
from app.core.errors import api_error
from app.db.session import get_db
from app.models import User
from app.schemas_reading import MAX_BLOCK_INDEX, READING_SPEEDS, ProgressIn, TtsIn
from app.services import reading
from app.services.material_corpus import get_corpus
from app.services.speech_client import AUDIO_ID_RE, DEFAULT_VOICES, SpeechError, get_speech_client

router = APIRouter(prefix="/api/reading", tags=["reading"])

ACCEPTED_AUDIO_TYPES = ("audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "video/webm")
MAX_ID_LENGTH = 256
ASSESS_MAX_SECONDS = 90


def reading_user(current_user: User = Depends(get_current_user_required)) -> User:
    if not settings.reading_enabled:
        raise api_error(404, "reading_disabled", "Reading is not enabled.")
    return current_user


def _check_id(value: str, code: str) -> str:
    if not value or len(value) > MAX_ID_LENGTH:
        raise api_error(404, code, "Not found.")
    return value


def _raise_speech(exc: SpeechError) -> None:
    raise api_error(exc.status_code, exc.code, exc.message)


def _speech_or_503():
    client = get_speech_client()
    if client is None:
        raise api_error(503, "speech_unavailable", "Speech service is not configured.")
    return client


# ---------------------------------------------------------------------------- capabilities
@router.get("/capabilities")
def capabilities(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_required)) -> dict[str, Any]:
    if not settings.reading_enabled:
        return {"enabled": False}
    client = get_speech_client()
    health = client.health() if client is not None else None
    tts: dict[str, Any] = {"available": False, "reason": "speech_unavailable", "engine": None, "model": None,
                           "default_voice": "af_heart", "voices": [dict(v) for v in DEFAULT_VOICES], "speeds": list(READING_SPEEDS)}
    assess: dict[str, Any] = {"available": False, "reason": "speech_unavailable", "engine": None, "model": None,
                              "max_audio_bytes": int(settings.speech_max_audio_bytes), "max_seconds": ASSESS_MAX_SECONDS}
    if health is not None and health.status != "unavailable":
        warming = health.status == "warming"
        tts_engine = str(health.tts.get("engine") or "none")
        asr_engine = str(health.asr.get("engine") or "none")
        voices = health.tts.get("voices") or []
        tts.update({
            "available": health.tts_ready,
            "reason": None if health.tts_ready else ("disabled" if tts_engine == "none" else "speech_warming" if warming or not health.tts.get("ready") else "speech_unavailable"),
            "engine": None if tts_engine == "none" else tts_engine,
            "model": health.tts.get("model"),
            "default_voice": str(health.tts.get("default_voice") or "af_heart"),
            "voices": [dict(v) for v in voices] if voices else [dict(v) for v in DEFAULT_VOICES],
        })
        assess.update({
            "available": health.asr_ready,
            "reason": None if health.asr_ready else ("disabled" if asr_engine == "none" else "speech_warming" if warming or not health.asr.get("ready") else "speech_unavailable"),
            "engine": None if asr_engine == "none" else asr_engine,
            "model": health.asr.get("model"),
        })
    limit = max(int(settings.reading_daily_assess_quota or 0), 0)
    used = reading.attempts_today(db, current_user)
    return {
        "enabled": True,
        "books_available": bool(get_corpus() and get_corpus().books),
        "tts": tts,
        "assess": assess,
        "quota": {"daily_limit": limit, "used_today": used, "remaining": max(limit - used, 0)},
    }


# ---------------------------------------------------------------------------- library
@router.get("/library")
def library(db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    return reading.build_library(db, user)


@router.get("/books/{slug}/chapters/{chapter_file}")
def chapter(slug: str, chapter_file: str, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    _check_id(slug, "book_not_found")
    _check_id(chapter_file, "chapter_not_found")
    corpus = get_corpus()
    if corpus is None or slug not in corpus.books:
        raise api_error(404, "book_not_found", "Book not found.")
    detail = reading.build_chapter(db, user, slug, chapter_file)
    if detail is None:
        raise api_error(404, "chapter_not_found", "Chapter not found.")
    return detail


# Registered before the generic section route: ``{section_id:path}`` is greedy and would swallow
# ``…/attempts`` otherwise.
@router.get("/sections/{section_id:path}/attempts")
def attempts(
    section_id: str,
    limit: int = Query(default=20, ge=1, le=reading.MAX_ATTEMPT_LIMIT),
    db: Session = Depends(get_db),
    user: User = Depends(reading_user),
) -> dict[str, Any]:
    _check_id(section_id, "section_not_found")
    return {"attempts": reading.list_attempts(db, user, section_id, limit=limit)}


@router.get("/sections/{section_id:path}")
def section(section_id: str, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    _check_id(section_id, "section_not_found")
    detail = reading.build_section(db, user, section_id)
    if detail is None:
        raise api_error(404, "section_not_found", "Section not found.")
    return detail


# ---------------------------------------------------------------------------- speech
@router.post("/sections/{section_id:path}/tts")
def tts(section_id: str, body: TtsIn, user: User = Depends(reading_user)) -> dict[str, Any]:
    _check_id(section_id, "section_not_found")
    resolved = reading.resolve_block(section_id, body.part_id, body.block_index)
    if resolved is None:
        raise api_error(404, "block_not_found", "Block not found.")
    _section, _part, text = resolved
    client = _speech_or_503()
    health = client.health()
    voices = {str(v.get("id")) for v in (health.tts.get("voices") or DEFAULT_VOICES)}
    voice = body.voice or str(health.tts.get("default_voice") or "af_heart")
    if voice not in voices:
        raise api_error(400, "voice_invalid", "Unknown voice.")
    speed = float(body.speed if body.speed is not None else 1.0)
    try:
        result = client.tts(text, voice=voice, speed=speed)
    except SpeechError as exc:
        _raise_speech(exc)
    result["text"] = text
    result["audio_url"] = f"/api/reading/audio/{result.get('audio_id', '')}"
    return result


@router.get("/audio/{audio_id}")
def audio(audio_id: str, user: User = Depends(reading_user)) -> Response:
    if not AUDIO_ID_RE.match(audio_id or ""):
        raise api_error(404, "audio_not_found", "Audio not found.")
    client = _speech_or_503()
    try:
        payload, content_type = client.audio(audio_id)
    except SpeechError as exc:
        _raise_speech(exc)
    return Response(
        content=payload,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"},
    )


def _audio_type(upload: UploadFile) -> str:
    content_type = str(upload.content_type or "").split(";")[0].strip().lower()
    if content_type not in ACCEPTED_AUDIO_TYPES:
        raise api_error(415, "audio_unsupported", "Unsupported audio type.")
    return content_type


async def _read_upload(upload: UploadFile, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise api_error(413, "audio_too_large", "Recording is too large.")
        chunks.append(chunk)
    if total == 0:
        raise api_error(400, "audio_invalid", "Empty recording.")
    return b"".join(chunks)


@router.post("/sections/{section_id:path}/assess")
async def assess(
    section_id: str,
    audio: UploadFile = File(...),
    part_id: str = Form(..., min_length=1, max_length=MAX_ID_LENGTH),
    block_index: int = Form(..., ge=0, le=MAX_BLOCK_INDEX),
    db: Session = Depends(get_db),
    user: User = Depends(reading_user),
) -> dict[str, Any]:
    _check_id(section_id, "section_not_found")
    resolved = reading.resolve_block(section_id, part_id, block_index)
    if resolved is None:
        raise api_error(404, "block_not_found", "Block not found.")
    section_obj, _part, text = resolved
    content_type = _audio_type(audio)
    client = _speech_or_503()
    limit = max(int(settings.reading_daily_assess_quota or 0), 0)
    if limit and reading.attempts_today(db, user) >= limit:
        raise api_error(429, "reading_quota_exceeded", "Daily assessment quota reached.")
    payload = await _read_upload(audio, int(settings.speech_max_audio_bytes))
    filename = audio.filename or "recording"
    try:
        from starlette.concurrency import run_in_threadpool

        result = await run_in_threadpool(client.assess, payload, content_type=content_type, filename=filename, reference_text=text)
    except SpeechError as exc:
        _raise_speech(exc)
    row = reading.record_attempt(db, user, section=section_obj, part_id=part_id, block_index=block_index, assessment=result)
    result["text"] = text
    result["attempt_id"] = row.id
    result["created_at"] = reading._iso(row.created_at)
    result.update(reading.block_summary(db, user, section_id, part_id, block_index))
    return result


# ---------------------------------------------------------------------------- progress / history
@router.put("/progress")
def put_progress(body: ProgressIn, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    corpus = get_corpus()
    if corpus is None or body.book_slug not in corpus.books:
        raise api_error(404, "book_not_found", "Book not found.")
    section_obj = corpus.get(body.section_id)
    if section_obj is None or section_obj.book_slug != body.book_slug:
        raise api_error(404, "section_not_found", "Section not found.")
    row = reading.upsert_progress(db, user, body.model_dump())
    return reading.serialize_progress(row, corpus)


@router.get("/progress")
def get_progress(db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    return {"items": reading.list_progress(db, user)}


@router.get("/stats")
def stats(db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    return reading.build_stats(db, user)
