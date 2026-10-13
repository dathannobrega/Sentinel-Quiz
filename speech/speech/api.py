"""HTTP routes (contract 1 §5.1, contract 3 §2.2-§2.3).

Inference runs in Starlette's thread pool behind one two-class queue per engine
(:class:`EngineQueue`, capacity ``SPEECH_MAX_CONCURRENCY``). ``X-Speech-Priority:
low`` requests (warm-up jobs) only get a slot when no ``normal`` request is waiting
and give up with ``503 busy`` after ``SPEECH_LOW_PRIORITY_WAIT_SECONDS``; ``normal``
requests wait up to ``SPEECH_BUSY_WAIT_SECONDS``. Cache hits never touch the queue, so
playing an already synthesized paragraph is always instant.

``POST /v1/tts/stream`` answers NDJSON, one line per sentence as soon as it exists.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import APIRouter, Depends, FastAPI, File, Form, Header, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, StringConstraints
from starlette.concurrency import run_in_threadpool

from .config import Settings
from .engines.base import EngineError
from .errors import api_error
from .metrics import Metrics
from .service import ServiceError, SpeechService

logger = logging.getLogger("speech.api")

AUDIO_ID_RE = re.compile(r"^[0-9a-f]{64}$")
TTS_LANGS = {"en-us", "en-gb"}
ASSESS_LANGS = {"en", "en-us", "en-gb"}
G2P_LANGS = {"en-us", "en-gb"}
RETRY_AFTER = {"Retry-After": "5"}
PRIORITIES = ("normal", "low")
PRIORITY_HEADER = "x-speech-priority"
STREAM_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}
NDJSON = "application/x-ndjson"


class TTSRequest(BaseModel):
    text: str | None = None
    voice: str | None = None
    speed: float = Field(default=1.0, ge=0.5, le=1.5)
    lang: str = "en-us"


class G2PRequest(BaseModel):
    words: list[Annotated[str, StringConstraints(min_length=1, max_length=64)]] = Field(min_length=1, max_length=50)
    lang: str = "en-us"


def request_priority(request: Request) -> str:
    """``X-Speech-Priority`` normalised to ``low`` or ``normal`` (anything else = normal)."""
    raw = (request.headers.get(PRIORITY_HEADER) or "").strip().lower()
    return "low" if raw == "low" else "normal"


class Busy(Exception):
    """No inference slot within the allowed wait."""


class EngineQueue:
    """Two-class FIFO queue in front of ``capacity`` inference slots (one per engine).

    Dispatch always serves the ``normal`` queue first: a ``low`` waiter only gets a slot
    when no ``normal`` request is waiting, and a ``normal`` request never waits for a
    ``low`` one beyond the slot already in use. Single-threaded by construction (event
    loop only), so no locks are needed.
    """

    def __init__(self, capacity: int) -> None:
        self.capacity = max(1, int(capacity))
        self.in_use = 0
        self._waiting: dict[str, deque[asyncio.Future[None]]] = {"normal": deque(), "low": deque()}

    def waiting(self, priority: str) -> int:
        return sum(1 for fut in self._waiting[priority] if not fut.done())

    def _dispatch(self) -> None:
        while self.in_use < self.capacity:
            queue = self._waiting["normal"] if self.waiting("normal") else self._waiting["low"]
            fut: asyncio.Future[None] | None = None
            while queue:
                candidate = queue.popleft()
                if not candidate.done():  # skip waiters that timed out meanwhile
                    fut = candidate
                    break
            if fut is None:
                return
            self.in_use += 1
            fut.set_result(None)

    async def acquire(self, priority: str, timeout: float) -> float:
        """Take a slot; returns the seconds spent waiting. Raises :class:`Busy` on timeout."""
        started = time.perf_counter()
        if self.in_use < self.capacity and (priority == "normal" or not self.waiting("normal")):
            self.in_use += 1
            return 0.0
        fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self._waiting[priority].append(fut)
        try:
            await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            if fut.done() and not fut.cancelled():
                # Granted in the same tick the timeout fired: keep the slot after all.
                return time.perf_counter() - started
            raise Busy() from None
        return time.perf_counter() - started

    def release(self) -> None:
        self.in_use = max(0, self.in_use - 1)
        self._dispatch()


class Limiter:
    """One :class:`EngineQueue` per engine plus the wait/metrics plumbing."""

    def __init__(self, settings: Settings, capacity: int, metrics: Metrics | None = None) -> None:
        self.wait = {"normal": settings.busy_wait_seconds, "low": settings.low_priority_wait_seconds}
        self.metrics = metrics
        self.tts = EngineQueue(capacity)
        self.asr = EngineQueue(capacity)
        self._names = {id(self.tts): "tts", id(self.asr): "asr"}

    async def acquire(self, queue: EngineQueue, priority: str) -> None:
        try:
            waited = await queue.acquire(priority, self.wait[priority])
        except Busy:
            if self.metrics is not None:
                self.metrics.queue_wait.labels(engine=self._names[id(queue)], priority=priority).observe(self.wait[priority])
            raise api_error(503, "busy", "all inference slots are busy, retry later", headers=RETRY_AFTER) from None
        if self.metrics is not None:
            self.metrics.queue_wait.labels(engine=self._names[id(queue)], priority=priority).observe(waited)

    @asynccontextmanager
    async def slot(self, queue: EngineQueue, priority: str = "normal") -> AsyncIterator[None]:
        await self.acquire(queue, priority)
        try:
            yield
        finally:
            queue.release()


def _service(request: Request) -> SpeechService:
    return request.app.state.service


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _limiter(request: Request) -> Limiter:
    limiter = getattr(request.app.state, "limiter", None)
    if limiter is None:  # no lifespan (e.g. a raw ASGI transport in tests): build it lazily
        service: SpeechService = request.app.state.service
        limiter = Limiter(request.app.state.settings, service.runtime.max_concurrency, service.metrics)
        request.app.state.limiter = limiter
    return limiter


async def require_token(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    """Shared-secret check; a no-op when SPEECH_API_TOKEN is empty (internal network)."""
    token = _settings(request).api_token
    if not token:
        return
    if authorization != f"Bearer {token}":
        raise api_error(401, "unauthorized", "missing or invalid bearer token")


def _raise(exc: ServiceError) -> None:
    headers = RETRY_AFTER if exc.status == 503 else None
    raise api_error(exc.status, exc.code, exc.message, headers=headers)


def _validate_tts(service: SpeechService, payload: TTSRequest) -> tuple[str, str, float, str]:
    try:
        text = service.validate_text(payload.text)
        voice = service.validate_voice(payload.voice)
    except ServiceError as exc:
        _raise(exc)
    lang = payload.lang.lower()
    if lang not in TTS_LANGS:
        raise api_error(400, "lang_invalid", f"lang must be one of {sorted(TTS_LANGS)}")
    return text, voice, round(float(payload.speed), 3), lang


router = APIRouter()
v1 = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])


@router.get("/healthz")
async def healthz(request: Request) -> JSONResponse:
    return JSONResponse(_service(request).health())


@router.get("/metrics", dependencies=[Depends(require_token)])
async def metrics(request: Request) -> Response:
    service = _service(request)
    payload = await run_in_threadpool(service.metrics_payload)
    return Response(content=payload, media_type=service.metrics.content_type)


@v1.post("/tts")
async def tts(payload: TTSRequest, request: Request) -> dict:
    service, limiter = _service(request), _limiter(request)
    text, voice, speed, lang = _validate_tts(service, payload)
    priority = request_priority(request)

    audio_id = service.tts_audio_id(text, voice, speed, lang)
    hit = service.cached_tts(audio_id)
    (service.metrics.cache_hits if hit is not None else service.metrics.cache_misses).inc()
    if hit is None:
        async with limiter.slot(limiter.tts, priority):
            # Re-check: another request may have produced the same audio while we waited.
            hit = service.cached_tts(audio_id)
            if hit is None:
                try:
                    hit = await run_in_threadpool(service.synthesize, text, voice, speed, lang)
                except ServiceError as exc:
                    _raise(exc)
                except EngineError as exc:
                    raise api_error(500, "tts_failed", str(exc)) from exc
    return {
        "audio_id": hit.audio_id,
        "content_type": hit.content_type,
        "duration_seconds": hit.duration_seconds,
        "sample_rate": hit.sample_rate,
        "cached": hit.cached,
        "engine": hit.engine,
        "model": hit.model,
        "voice": hit.voice,
        "speed": hit.speed,
        "lang": hit.lang,
        "words": hit.words,
    }


def _ndjson(obj: dict[str, Any]) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


async def stream_sentences(
    service: SpeechService,
    limiter: Limiter,
    *,
    text: str,
    voice: str,
    speed: float,
    lang: str,
    priority: str,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[bytes]:
    """NDJSON lines ``meta`` -> ``segment``... -> ``done`` (or ``error`` after ``meta``).

    Cached sentences stream immediately without a slot. The first uncached sentence
    takes one slot of the TTS queue and keeps it until the stream ends: releasing it
    between sentences would let another block interleave and stall this reader
    mid-paragraph, while the priority queue already keeps warm-up traffic behind
    readers. The loop stops as soon as the client goes away.
    """
    spans = service.sentence_spans(text)
    block_id = service.tts_audio_id(text, voice, speed, lang)
    content_type = "audio/mpeg" if service.audio_format == "mp3" else "audio/wav"
    yield _ndjson(
        {
            "type": "meta",
            "block_audio_id": block_id,
            "sentences": len(spans),
            "engine": service.tts.name,
            "model": service.tts.model,
            "voice": voice,
            "speed": speed,
            "lang": lang,
            "content_type": content_type,
        }
    )
    holding = False
    total = 0.0
    try:
        for index, span in enumerate(spans):
            if await is_disconnected():
                logger.info("tts stream: client disconnected after %d/%d sentences", index, len(spans))
                return
            sentence = service.cached_sentence(text, span, voice, speed, lang, index)
            if sentence is not None:
                service.metrics.cache_hits.inc()
            else:
                service.metrics.cache_misses.inc()
                if not holding:
                    await limiter.acquire(limiter.tts, priority)
                    holding = True
                sentence = await run_in_threadpool(service.synthesize_sentence, text, span, voice, speed, lang, index)
            total += sentence.duration_seconds
            yield _ndjson(sentence.as_segment())
        yield _ndjson({"type": "done", "duration_seconds": round(total, 3)})
    except ServiceError as exc:
        yield _ndjson({"type": "error", "code": exc.code, "message": exc.message})
    except EngineError as exc:
        yield _ndjson({"type": "error", "code": "tts_failed", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001 - the status is already 200: report in-band
        detail = getattr(exc, "detail", None)
        if isinstance(detail, dict) and "code" in detail:  # api_error raised by the limiter (busy)
            yield _ndjson({"type": "error", "code": str(detail["code"]), "message": str(detail.get("message", ""))})
        else:
            logger.exception("tts stream failed")
            yield _ndjson({"type": "error", "code": "tts_failed", "message": "synthesis failed"})
    finally:
        if holding:
            limiter.tts.release()


@v1.post("/tts/stream")
async def tts_stream(payload: TTSRequest, request: Request) -> StreamingResponse:
    service, limiter = _service(request), _limiter(request)
    text, voice, speed, lang = _validate_tts(service, payload)
    priority = request_priority(request)
    # Readiness errors (503 model_not_ready / engine_disabled) must come out as plain JSON
    # before the first byte; after ``meta`` everything is reported in-band.
    try:
        await run_in_threadpool(service.ensure_tts_ready)
    except ServiceError as exc:
        _raise(exc)
    body = stream_sentences(
        service, limiter, text=text, voice=voice, speed=speed, lang=lang, priority=priority,
        is_disconnected=request.is_disconnected,
    )
    return StreamingResponse(body, media_type=NDJSON, headers=STREAM_HEADERS)


@v1.get("/audio/{audio_id}")
async def audio(audio_id: str, request: Request) -> FileResponse:
    if not AUDIO_ID_RE.match(audio_id):
        raise api_error(404, "audio_not_found", "unknown audio id")
    hit = _service(request).audio_file(audio_id)
    if hit is None:
        raise api_error(404, "audio_not_found", "audio expired from cache")
    return FileResponse(hit.audio_path, media_type=hit.content_type, headers={"Cache-Control": "private, max-age=86400"})


@v1.post("/assess")
async def assess(
    request: Request,
    audio: Annotated[UploadFile, File()],
    reference_text: Annotated[str, Form()] = "",
    lang: Annotated[str, Form()] = "en",
) -> dict:
    service, settings, limiter = _service(request), _settings(request), _limiter(request)
    if lang.lower() not in ASSESS_LANGS:
        raise api_error(400, "lang_invalid", f"lang must be one of {sorted(ASSESS_LANGS)}")
    try:
        service.validate_text(reference_text)
    except ServiceError as exc:
        _raise(exc)
    # Read at most limit+1 bytes so an oversized upload is rejected without buffering it.
    data = await audio.read(settings.max_audio_bytes + 1)
    if len(data) > settings.max_audio_bytes:
        raise api_error(413, "audio_too_large", f"audio exceeds {settings.max_audio_bytes} bytes")
    if not data:
        raise api_error(400, "audio_invalid", "audio is empty")
    async with limiter.slot(limiter.asr, request_priority(request)):
        try:
            return await run_in_threadpool(service.assess, data, audio.content_type, reference_text, lang.lower())
        except ServiceError as exc:
            _raise(exc)
        except EngineError as exc:
            raise api_error(500, "asr_failed", str(exc)) from exc
    raise AssertionError("unreachable")  # pragma: no cover


@v1.post("/g2p")
async def g2p(payload: G2PRequest, request: Request) -> dict:
    lang = payload.lang.lower()
    if lang not in G2P_LANGS:
        raise api_error(400, "lang_invalid", f"lang must be one of {sorted(G2P_LANGS)}")
    items = await run_in_threadpool(_service(request).g2p, payload.words, lang)
    return {"items": items}


def register_routes(app: FastAPI) -> None:
    app.include_router(router)
    app.include_router(v1)
