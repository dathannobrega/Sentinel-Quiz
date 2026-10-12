"""HTTP routes (contract §5.1).

Inference runs in Starlette's thread pool behind one ``asyncio.Semaphore`` per engine
(``SPEECH_MAX_CONCURRENCY``): a request waits up to ``SPEECH_BUSY_WAIT_SECONDS`` for a
slot and then gets ``503 busy`` with ``Retry-After``. Cache hits never touch the
semaphore, so playing an already synthesized paragraph is always instant.
"""
from __future__ import annotations

import asyncio
import re
from contextlib import asynccontextmanager
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends, FastAPI, File, Form, Header, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, StringConstraints
from starlette.concurrency import run_in_threadpool

from .config import Settings
from .engines.base import EngineError
from .errors import api_error
from .service import ServiceError, SpeechService

AUDIO_ID_RE = re.compile(r"^[0-9a-f]{64}$")
TTS_LANGS = {"en-us", "en-gb"}
ASSESS_LANGS = {"en", "en-us", "en-gb"}
G2P_LANGS = {"en-us", "en-gb"}
RETRY_AFTER = {"Retry-After": "5"}


class TTSRequest(BaseModel):
    text: str | None = None
    voice: str | None = None
    speed: float = Field(default=1.0, ge=0.5, le=1.5)
    lang: str = "en-us"


class G2PRequest(BaseModel):
    words: list[Annotated[str, StringConstraints(min_length=1, max_length=64)]] = Field(min_length=1, max_length=50)
    lang: str = "en-us"


class Limiter:
    """One semaphore per engine; raises 503 busy after the configured wait."""

    def __init__(self, settings: Settings) -> None:
        self.wait = settings.busy_wait_seconds
        self.tts = asyncio.Semaphore(max(1, settings.max_concurrency))
        self.asr = asyncio.Semaphore(max(1, settings.max_concurrency))

    @asynccontextmanager
    async def slot(self, sem: asyncio.Semaphore) -> AsyncIterator[None]:
        try:
            await asyncio.wait_for(sem.acquire(), timeout=self.wait)
        except asyncio.TimeoutError:
            raise api_error(503, "busy", "all inference slots are busy, retry later", headers=RETRY_AFTER) from None
        try:
            yield
        finally:
            sem.release()


def _service(request: Request) -> SpeechService:
    return request.app.state.service


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _limiter(request: Request) -> Limiter:
    return request.app.state.limiter


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
    try:
        text = service.validate_text(payload.text)
        voice = service.validate_voice(payload.voice)
    except ServiceError as exc:
        _raise(exc)
    lang = payload.lang.lower()
    if lang not in TTS_LANGS:
        raise api_error(400, "lang_invalid", f"lang must be one of {sorted(TTS_LANGS)}")
    speed = round(float(payload.speed), 3)

    audio_id = service.tts_audio_id(text, voice, speed, lang)
    hit = service.cached_tts(audio_id)
    (service.metrics.cache_hits if hit is not None else service.metrics.cache_misses).inc()
    if hit is None:
        async with limiter.slot(limiter.tts):
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
    async with limiter.slot(limiter.asr):
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
