"""Sentinel Reader API (``/api/reading/*``, docs/reading/CONTRATO-INCREMENTO-1.md §4 and
CONTRATO-INCREMENTO-2.md §3).

Signed-in users only (the books are licensed, like ``/api/materials/*``). Text is always resolved
server-side from the corpus (or from a stored word card): the client names a block, a sentence or
a character range, never sends text. The speech service and the AI are optional; their absence
degrades ``capabilities`` instead of failing the reader.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_current_user_required
from app.core.config import settings
from app.core.errors import api_error
from app.db.session import get_db
from app.models import User
from app.schemas_reading import (
    MAX_BLOCK_INDEX,
    MAX_SENTENCE_INDEX,
    READING_SPEEDS,
    GlossaryIn,
    GradeIn,
    ProgressIn,
    QuizAnswerIn,
    TtsIn,
    WarmIn,
    WordIn,
    WordTtsIn,
)
from app.services import reading, reading_ai, reading_data, reading_warm, reading_words
from app.services.material_corpus import CorpusSection, get_corpus
from app.services.speech_client import AUDIO_ID_RE, DEFAULT_VOICES, SpeechError, get_speech_client

router = APIRouter(prefix="/api/reading", tags=["reading"])
logger = logging.getLogger("app.reading")

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


def _log_upstream(event: str, started: float, *, cached: bool | None = None, code: str | None = None, **fields: Any) -> None:
    """One structured line per speech-service call (``reading_tts`` / ``reading_assess``)."""
    logger.info(
        "Reading upstream call",
        extra={"event": event, "duration_ms": round((time.perf_counter() - started) * 1000, 2), "cached": cached, "code": code, **fields},
    )


def _speech_or_503():
    client = get_speech_client()
    if client is None:
        raise api_error(503, "speech_unavailable", "Speech service is not configured.")
    return client


def _check_language(section: CorpusSection) -> None:
    """Increment 3 (§3.3): speech features exist for English books only; the 409 carries the
    detected language so the reader can pick the browser voice for it."""
    if reading.speech_supported(section):
        return
    exc = api_error(409, "language_unsupported", "Speech features are available for English books only.")
    exc.detail["language"] = reading.book_language(section)  # type: ignore[index]
    raise exc


def _resolve_voice(client: Any, voice: str | None, speed: float | None) -> tuple[str, float]:
    """Validated ``(voice, speed)`` against the service's voice list (shared by TTS, stream, warm)."""
    health = client.health()
    voices = {str(v.get("id")) for v in (health.tts.get("voices") or DEFAULT_VOICES)}
    voice = voice or str(health.tts.get("default_voice") or "af_heart")
    if voice not in voices:
        raise api_error(400, "voice_invalid", "Unknown voice.")
    return voice, float(speed if speed is not None else 1.0)


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
    # Increment 3 (§3.4): the sentence stream needs a TTS engine that is up (``tts.ready``).
    tts["streaming"] = bool(tts["available"])
    limit = max(int(settings.reading_daily_assess_quota or 0), 0)
    used = reading.assess_used_today(db, current_user)
    phonemes_ready = bool(health is not None and health.status != "unavailable" and health.phoneme_ready)
    return {
        "enabled": True,
        "books_available": bool(get_corpus() and get_corpus().books),
        "tts": tts,
        "assess": assess,
        "quota": {"daily_limit": limit, "used_today": used, "remaining": max(limit - used, 0)},
        "ai": reading_ai.ai_status(),
        "phonemes": {"available": phonemes_ready},
        "words": {"due": reading_words.due_count(db, current_user)},
        "offline": {"max_chapters": max(int(settings.reading_max_offline_chapters or 0), 0)},
        "warm": {"enabled": bool(settings.reading_warm_enabled), "blocks_ahead": max(int(settings.reading_warm_blocks_ahead or 0), 0)},
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


@router.get("/books/{slug}/chapters/{chapter_file}/offline-manifest")
def offline_manifest(slug: str, chapter_file: str, user: User = Depends(reading_user)) -> dict[str, Any]:
    _check_id(slug, "book_not_found")
    _check_id(chapter_file, "chapter_not_found")
    corpus = get_corpus()
    if corpus is None or slug not in corpus.books:
        raise api_error(404, "book_not_found", "Book not found.")
    manifest = reading.build_offline_manifest(slug, chapter_file)
    if manifest is None:
        raise api_error(404, "chapter_not_found", "Chapter not found.")
    return manifest


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


@router.get("/sections/{section_id:path}/tts/stream")
async def tts_stream(
    section_id: str,
    part_id: str = Query(..., min_length=1, max_length=MAX_ID_LENGTH),
    block_index: int = Query(..., ge=0, le=MAX_BLOCK_INDEX),
    voice: str | None = Query(default=None, max_length=32, pattern=r"^[a-z]{2}_[a-z]{2,24}$"),
    speed: float | None = Query(default=None, ge=0.5, le=1.5),
    user: User = Depends(reading_user),
) -> StreamingResponse:
    """Sentence-by-sentence synthesis of a block (Increment 3 §3.1): the speech service's NDJSON,
    forwarded line by line so the first sentence plays while the rest is still being synthesized.

    Every ``segment`` gains ``audio_url`` and the ``meta`` line gains the block ``text``. Anything
    that can fail before the first line (block, voice, language, service down) is a normal JSON
    error; once the 200 is on the wire an upstream failure becomes an ``error`` line.
    """
    _check_id(section_id, "section_not_found")
    resolved = reading.resolve_block(section_id, part_id, block_index)
    if resolved is None:
        raise api_error(404, "block_not_found", "Block not found.")
    section_obj, _part, text = resolved
    _check_language(section_obj)
    client = _speech_or_503()
    voice, speed = await run_in_threadpool(_resolve_voice, client, voice, speed)
    started = time.perf_counter()
    upstream = client.tts_stream(text, voice=voice, speed=speed)
    try:
        first = await upstream.__anext__()
    except StopAsyncIteration:
        raise api_error(502, "speech_error", "Speech service sent an empty stream.")
    except SpeechError as exc:
        _log_upstream("reading_tts_stream", started, code=exc.code, kind="block")
        _raise_speech(exc)

    async def body():
        lines = 0
        code: str | None = None
        try:
            yield _rewrite_stream_line(first, text) + "\n"
            lines += 1
            async for line in upstream:
                yield _rewrite_stream_line(line, text) + "\n"
                lines += 1
        except SpeechError as exc:
            code = exc.code
            yield json.dumps({"type": "error", "code": exc.code, "message": exc.message}) + "\n"
        finally:
            _log_upstream("reading_tts_stream", started, code=code, kind="block", lines=lines)

    return StreamingResponse(
        body(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff"},
    )


def _rewrite_stream_line(line: str, text: str) -> str:
    """Add what only this API knows: the audio URL of a segment and the text of the block."""
    try:
        event = json.loads(line)
    except ValueError:
        return line
    if not isinstance(event, dict):
        return line
    kind = event.get("type")
    if kind == "segment":
        event["audio_url"] = f"/api/reading/audio/{event.get('audio_id', '')}"
    elif kind == "meta":
        event["text"] = text
    return json.dumps(event, ensure_ascii=False)


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
    section_obj, _part, text = resolved
    _check_language(section_obj)
    return _synthesize(text, body.voice, body.speed, kind="block")


@router.post("/sections/{section_id:path}/warm", status_code=202)
def warm(section_id: str, body: WarmIn, user: User = Depends(reading_user)) -> dict[str, Any]:
    """Queue the next paragraphs for low-priority synthesis (Increment 3 §3.2)."""
    _check_id(section_id, "section_not_found")
    resolved = reading.resolve_block(section_id, body.part_id, body.block_index)
    if resolved is None:
        raise api_error(404, "block_not_found", "Block not found.")
    section_obj, _part, _text = resolved
    _check_language(section_obj)
    if not settings.reading_warm_enabled:
        return {"queued": 0, "skipped": 0, "enabled": False}
    client = _speech_or_503()
    voice, speed = _resolve_voice(client, body.voice, body.speed)
    return reading_warm.scheduler.schedule(section_id, body.part_id, body.block_index, voice=voice, speed=speed)


def _synthesize(text: str, voice: str | None, speed: float | None, *, kind: str) -> dict[str, Any]:
    """TTS of server-resolved text (a block or a stored word), same response for both."""
    client = _speech_or_503()
    voice, speed = _resolve_voice(client, voice, speed)
    started = time.perf_counter()
    try:
        result = client.tts(text, voice=voice, speed=speed)
    except SpeechError as exc:
        _log_upstream("reading_tts", started, code=exc.code, kind=kind)
        _raise_speech(exc)
    _log_upstream("reading_tts", started, cached=bool(result.get("cached")), kind=kind)
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


def _check_assess_quota(db: Session, user: User) -> None:
    limit = max(int(settings.reading_daily_assess_quota or 0), 0)
    if limit and reading.assess_used_today(db, user) >= limit:
        raise api_error(429, "reading_quota_exceeded", "Daily assessment quota reached.")


async def _score(client: Any, payload: bytes, *, content_type: str, filename: str, reference_text: str, kind: str) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        result = await run_in_threadpool(client.assess, payload, content_type=content_type, filename=filename, reference_text=reference_text)
    except SpeechError as exc:
        _log_upstream("reading_assess", started, code=exc.code, kind=kind)
        _raise_speech(exc)
    _log_upstream("reading_assess", started, kind=kind)
    return result


@router.post("/sections/{section_id:path}/assess")
async def assess(
    section_id: str,
    audio: UploadFile = File(...),
    part_id: str = Form(..., min_length=1, max_length=MAX_ID_LENGTH),
    block_index: int = Form(..., ge=0, le=MAX_BLOCK_INDEX),
    sentence_index: int | None = Form(default=None, ge=0, le=MAX_SENTENCE_INDEX),
    db: Session = Depends(get_db),
    user: User = Depends(reading_user),
) -> dict[str, Any]:
    _check_id(section_id, "section_not_found")
    resolved = reading.resolve_block(section_id, part_id, block_index)
    if resolved is None:
        raise api_error(404, "block_not_found", "Block not found.")
    section_obj, _part, block_text = resolved
    _check_language(section_obj)
    # Drill (§3.1): the reference is one sentence of the block; offsets in the answer are
    # relative to it and ``char_offset`` places it in the block.
    char_offset, text = 0, block_text
    if sentence_index is not None:
        sentence = reading.resolve_sentence(block_text, sentence_index)
        if sentence is None:
            raise api_error(404, "sentence_not_found", "Sentence not found.")
        char_offset, text = sentence
    content_type = _audio_type(audio)
    client = _speech_or_503()
    _check_assess_quota(db, user)
    payload = await _read_upload(audio, int(settings.speech_max_audio_bytes))
    result = await _score(
        client, payload, content_type=content_type, filename=audio.filename or "recording", reference_text=text,
        kind="sentence" if sentence_index is not None else "block",
    )
    row = reading.record_attempt(
        db, user, section=section_obj, part_id=part_id, block_index=block_index, assessment=result, sentence_index=sentence_index
    )
    deck = reading_words.apply_assessment(
        db, user, result, reference_text=text, section_id=section_obj.id, part_id=part_id, block_index=block_index
    )
    result["text"] = text
    result["sentence_index"] = sentence_index
    result["char_offset"] = char_offset
    result["attempt_id"] = row.id
    result["created_at"] = reading._iso(row.created_at)
    result["deck"] = deck
    result.update(reading.block_summary(db, user, section_id, part_id, block_index, sentence_index))
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
    body = reading.build_stats(db, user)
    words = reading_words.summary(db, user)
    body["words"] = {"total": words["total"], "due": words["due"], "learned": words["learned"]}
    body["quiz"] = reading_ai.quiz_stats(db, user)
    return body


# ---------------------------------------------------------------------------- words (§3.2)
@router.get("/words")
def list_words(
    status: str = Query(default="all", pattern="^(due|all)$"),
    kind: str | None = Query(default=None, pattern="^(pronunciation|vocabulary)$"),
    limit: int = Query(default=50, ge=1, le=reading_words.MAX_LIST_LIMIT),
    offset: int = Query(default=0, ge=0, le=100_000),
    db: Session = Depends(get_db),
    user: User = Depends(reading_user),
) -> dict[str, Any]:
    return reading_words.list_cards(db, user, status=status, kind=kind, limit=limit, offset=offset)


@router.get("/words/summary")
def words_summary(db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    return reading_words.summary(db, user)


@router.post("/words", status_code=201)
def add_word(body: WordIn, response: Response, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    _check_id(body.section_id, "section_not_found")
    spot = reading_words.locate_word(body.section_id, body.part_id, body.block_index, body.char_start, body.char_end)
    # A word looked up in the glossary keeps its translation and counts as a glossary card.
    meaning = reading_ai.cached_meaning(spot.norm, spot.context, db)
    card, created = reading_words.add_card(
        db, user, spot, kind=body.kind, source="glossary" if meaning else "manual", meaning_pt=meaning,
    )
    if created and not card.ipa:
        ipa = reading_ai.ipa_for(card.display)
        if ipa:
            card.ipa = ipa[: reading_words.IPA_MAX]
            db.commit()
            db.refresh(card)
    if not created:
        response.status_code = 200
    return reading_words.serialize_card(card)


@router.delete("/words/{word_id}", status_code=204)
def delete_word(word_id: str, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> Response:
    reading_words.delete_card(db, user, word_id)
    return Response(status_code=204)


@router.post("/words/{word_id}/tts")
def word_tts(word_id: str, body: WordTtsIn, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    card = reading_words.get_card(db, user, word_id)
    return _synthesize(card.display, body.voice, body.speed, kind="word")


@router.post("/words/{word_id}/review")
async def review_word(
    word_id: str,
    audio: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(reading_user),
) -> dict[str, Any]:
    card = reading_words.get_card(db, user, word_id)
    content_type = _audio_type(audio)
    client = _speech_or_503()
    _check_assess_quota(db, user)
    payload = await _read_upload(audio, int(settings.speech_max_audio_bytes))
    reference = card.display
    result = await _score(client, payload, content_type=content_type, filename=audio.filename or "recording", reference_text=reference, kind="word")
    reading.record_call(db, user, reading.CALL_WORD_REVIEW)
    overall = float((result.get("scores") or {}).get("overall") or 0.0)
    grade = reading_words.grade_for_overall(overall)
    card = reading_words.grade_card(db, user, card.id, grade, score=overall)
    result["text"] = reference
    return {"assessment": result, "grade": grade, "card": reading_words.serialize_card(card)}


@router.post("/words/{word_id}/grade")
def grade_word(word_id: str, body: GradeIn, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    card = reading_words.grade_card(db, user, word_id, body.grade)
    return reading_words.serialize_card(card)


# ---------------------------------------------------------------------------- glossary (§3.3)
@router.post("/glossary")
def glossary(body: GlossaryIn, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    _check_id(body.section_id, "section_not_found")
    spot = reading_words.locate_word(body.section_id, body.part_id, body.block_index, body.char_start, body.char_end)
    return reading_ai.glossary(db, user, spot)


# ---------------------------------------------------------------------------- comprehension (§3.4)
@router.post("/sections/{section_id:path}/quiz/answer")
def quiz_answer(section_id: str, body: QuizAnswerIn, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    _check_id(section_id, "section_not_found")
    return reading_ai.answer_quiz(db, user, section_id, body.question_index, body.choice)


@router.post("/sections/{section_id:path}/quiz")
def quiz(section_id: str, db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    _check_id(section_id, "section_not_found")
    return reading_ai.get_or_create_quiz(db, user, section_id)


# ---------------------------------------------------------------------------- your data (§3.5)
@router.get("/me/export")
def export_data(db: Session = Depends(get_db), user: User = Depends(reading_user)) -> JSONResponse:
    body = reading_data.export_user_data(db, user)
    return JSONResponse(
        content=json.loads(json.dumps(body, ensure_ascii=False, default=str)),
        headers={
            "Content-Disposition": 'attachment; filename="sentinel-reader-dados.json"',
            "Cache-Control": "no-store",
        },
    )


@router.delete("/me")
def delete_data(db: Session = Depends(get_db), user: User = Depends(reading_user)) -> dict[str, Any]:
    return {"deleted": reading_data.delete_user_data(db, user)}
