"""Client of the speech service (``speech/``, contract docs/reading/CONTRATO-INCREMENTO-1.md §5).

The speech service is optional infrastructure: it lives on an internal network, is reached only
from here, and may be down or still loading its models. Every failure is mapped to a
:class:`SpeechError` with a stable ``code`` so the API can answer 503/504 and the reader can fall
back to the browser's speech synthesis.

``SPEECH_PROVIDER=fake`` swaps in :class:`FakeSpeechClient`, a deterministic in-process stand-in
for development and tests (no models, no network).
"""
from __future__ import annotations

import hashlib
import io
import math
import re
import struct
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings

HEALTH_CACHE_SECONDS = 30.0
AUDIO_ID_RE = re.compile(r"^[0-9a-f]{64}$")

# Shared with the UI (contract §4.1).
DEFAULT_VOICES: tuple[dict[str, str], ...] = (
    {"id": "af_heart", "label": "Heart", "lang": "en-US", "gender": "female"},
    {"id": "af_bella", "label": "Bella", "lang": "en-US", "gender": "female"},
    {"id": "af_nicole", "label": "Nicole", "lang": "en-US", "gender": "female"},
    {"id": "am_michael", "label": "Michael", "lang": "en-US", "gender": "male"},
    {"id": "am_adam", "label": "Adam", "lang": "en-US", "gender": "male"},
    {"id": "bf_emma", "label": "Emma", "lang": "en-GB", "gender": "female"},
    {"id": "bm_george", "label": "George", "lang": "en-GB", "gender": "male"},
)


class SpeechError(Exception):
    """Upstream problem already translated to an HTTP status and an error code."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


@dataclass(frozen=True)
class SpeechHealth:
    status: str  # ok | warming | degraded | unavailable
    tts: dict[str, Any]
    asr: dict[str, Any]

    @property
    def tts_ready(self) -> bool:
        return bool(self.tts.get("ready")) and str(self.tts.get("engine") or "none") != "none"

    @property
    def asr_ready(self) -> bool:
        return bool(self.asr.get("ready")) and str(self.asr.get("engine") or "none") != "none"


UNAVAILABLE = SpeechHealth(status="unavailable", tts={"engine": None, "ready": False}, asr={"engine": None, "ready": False})


def _voice_lang(voice: str) -> str:
    return "en-gb" if str(voice or "").startswith("b") else "en-us"


class SpeechClient:
    """Thin synchronous HTTP client (the API is sync SQLAlchemy code; calls run in the threadpool)."""

    def __init__(self, base_url: str, token: str = "", timeout_seconds: float = 60.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._token = token.strip()
        self._timeout = httpx.Timeout(timeout=timeout_seconds, connect=5.0, read=timeout_seconds, write=timeout_seconds)
        self._health_lock = threading.Lock()
        self._health_cache: tuple[float, SpeechHealth] | None = None

    # ------------------------------------------------------------------ helpers
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"} if self._token else {}

    def _raise_for(self, response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        code, message = "speech_error", f"Speech service answered {response.status_code}."
        try:
            body = response.json()
            code = str(body.get("code") or code)
            message = str(body.get("message") or message)
        except Exception:
            pass
        status = response.status_code
        if status == 503:
            # model_not_ready / engine_disabled / busy: the client may retry shortly.
            mapped = "speech_warming" if code == "model_not_ready" else "speech_unavailable"
            raise SpeechError(503, mapped, message)
        if status == 404:
            raise SpeechError(404, "audio_not_found" if code == "audio_not_found" else code, message)
        if status in (400, 413, 415, 422):
            raise SpeechError(status, code, message)
        if status == 401:
            raise SpeechError(503, "speech_unavailable", "Speech service rejected the API token.")
        raise SpeechError(502, "speech_error", message)

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            with httpx.Client(base_url=self.base_url, timeout=self._timeout, headers=self._headers()) as client:
                response = client.request(method, path, **kwargs)
        except httpx.TimeoutException as exc:
            raise SpeechError(504, "speech_timeout", "Speech service timed out.") from exc
        except httpx.HTTPError as exc:
            raise SpeechError(503, "speech_unavailable", "Speech service is unavailable.") from exc
        self._raise_for(response)
        return response

    # ------------------------------------------------------------------ API
    def health(self, *, force: bool = False) -> SpeechHealth:
        now = time.monotonic()
        with self._health_lock:
            cached = self._health_cache
            if cached and not force and now - cached[0] < HEALTH_CACHE_SECONDS:
                return cached[1]
        try:
            with httpx.Client(base_url=self.base_url, timeout=httpx.Timeout(5.0), headers=self._headers()) as client:
                response = client.get("/healthz")
            response.raise_for_status()
            body = response.json()
            health = SpeechHealth(
                status=str(body.get("status") or "ok"),
                tts=dict(body.get("tts") or {}),
                asr=dict(body.get("asr") or {}),
            )
        except Exception:
            health = UNAVAILABLE
        with self._health_lock:
            self._health_cache = (now, health)
        return health

    def tts(self, text: str, *, voice: str, speed: float) -> dict[str, Any]:
        response = self._request(
            "POST", "/v1/tts", json={"text": text, "voice": voice, "speed": speed, "lang": _voice_lang(voice)}
        )
        return response.json()

    def audio(self, audio_id: str) -> tuple[bytes, str]:
        if not AUDIO_ID_RE.match(audio_id):
            raise SpeechError(404, "audio_not_found", "Audio not found.")
        response = self._request("GET", f"/v1/audio/{audio_id}")
        return response.content, response.headers.get("content-type", "application/octet-stream")

    def assess(self, audio: bytes, *, content_type: str, filename: str, reference_text: str) -> dict[str, Any]:
        response = self._request(
            "POST",
            "/v1/assess",
            files={"audio": (filename, audio, content_type)},
            data={"reference_text": reference_text, "lang": "en"},
        )
        return response.json()


# ---------------------------------------------------------------------------- fake
_WORD_RE = re.compile(r"[\w'’-]+", re.UNICODE)


def _wav_bytes(seconds: float, sample_rate: int = 8000) -> bytes:
    """Tiny near-silent PCM WAV (keeps tests and the fake stack independent from ffmpeg)."""
    frames = max(int(seconds * sample_rate), 1)
    pcm = b"".join(struct.pack("<h", int(300 * math.sin(i / 7.0))) for i in range(frames))
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16)
    header += b"data" + struct.pack("<I", len(pcm))
    return header + pcm


def _normalize(word: str) -> str:
    return re.sub(r"[^\w']", "", word.lower().replace("’", "'"))


class FakeSpeechClient:
    """Deterministic stand-in: evenly spaced word timings; assessment driven by a ``FAKE:`` payload.

    When the uploaded "audio" is UTF-8 text starting with ``FAKE:``, the remainder is the
    transcript (words missing from it are ``missed``, words not in the reference are ``extras``).
    Any other payload is treated as a perfect reading.
    """

    base_url = "fake://speech"

    def __init__(self) -> None:
        self._audio: dict[str, tuple[bytes, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def health(self, *, force: bool = False) -> SpeechHealth:
        voices = [dict(voice) for voice in DEFAULT_VOICES]
        return SpeechHealth(
            status="ok",
            tts={"engine": "fake", "model": "fake", "ready": True, "voices": voices, "default_voice": "af_heart"},
            asr={"engine": "fake", "model": "fake", "ready": True},
        )

    @staticmethod
    def _words(text: str) -> list[dict[str, Any]]:
        matches = list(_WORD_RE.finditer(text))
        step = 0.3
        return [
            {"text": m.group(0), "start": round(i * step, 3), "end": round(i * step + 0.25, 3), "char_start": m.start(), "char_end": m.end()}
            for i, m in enumerate(matches)
        ]

    def tts(self, text: str, *, voice: str, speed: float) -> dict[str, Any]:
        words = self._words(text)
        duration = round(len(words) * 0.3 / max(speed, 0.1), 3)
        audio_id = hashlib.sha256(f"fake|{voice}|{speed}|{text}".encode("utf-8")).hexdigest()
        with self._lock:
            cached = audio_id in self._audio
            if not cached:
                self._audio[audio_id] = (_wav_bytes(min(duration, 2.0)), {"words": words})
        return {
            "audio_id": audio_id,
            "content_type": "audio/wav",
            "duration_seconds": duration,
            "sample_rate": 8000,
            "cached": cached,
            "engine": "fake",
            "model": "fake",
            "voice": voice,
            "speed": speed,
            "words": words,
        }

    def audio(self, audio_id: str) -> tuple[bytes, str]:
        with self._lock:
            entry = self._audio.get(audio_id)
        if entry is None:
            raise SpeechError(404, "audio_not_found", "Audio not found.")
        return entry[0], "audio/wav"

    def assess(self, audio: bytes, *, content_type: str, filename: str, reference_text: str) -> dict[str, Any]:
        reference = self._words(reference_text)
        transcript_words: list[str] | None = None
        if audio.startswith(b"FAKE:"):
            transcript_words = [_normalize(w) for w in _WORD_RE.findall(audio[5:].decode("utf-8", "ignore"))]
        heard_pool = list(transcript_words) if transcript_words is not None else None
        words: list[dict[str, Any]] = []
        ok = missed = 0
        for index, word in enumerate(reference):
            norm = _normalize(word["text"])
            if heard_pool is None or norm in heard_pool:
                if heard_pool is not None:
                    heard_pool.remove(norm)
                status, heard, confidence = "ok", norm, 0.95
                ok += 1
            else:
                status, heard, confidence = "missed", None, None
                missed += 1
            words.append({
                "index": index, "text": word["text"], "char_start": word["char_start"], "char_end": word["char_end"],
                "status": status, "heard": heard, "confidence": confidence,
                "start": word["start"] if status == "ok" else None, "end": word["end"] if status == "ok" else None,
                "expected_ipa": None, "heard_ipa": None,
            })
        extras = [{"text": w, "after_index": len(reference) - 1, "start": None, "end": None} for w in (heard_pool or [])]
        total = max(len(reference), 1)
        accuracy = ok / total
        completeness = (total - missed) / total
        fluency = max(0.0, 1.0 - 0.05 * len(extras))
        overall = 0.6 * accuracy + 0.2 * completeness + 0.2 * fluency
        speech_seconds = round(len(reference) * 0.3, 3)
        return {
            "engine": "fake",
            "model": "fake",
            "duration_seconds": speech_seconds + 0.5,
            "speech_seconds": speech_seconds,
            "transcript": " ".join(transcript_words) if transcript_words is not None else reference_text,
            "words": words,
            "extras": extras,
            "scores": {k: round(v, 3) for k, v in {"accuracy": accuracy, "completeness": completeness, "fluency": fluency, "overall": overall}.items()},
            "metrics": {
                "reference_words": len(reference), "ok": ok, "weak": 0, "mispronounced": 0, "missed": missed,
                "extra": len(extras), "wpm": round(len(reference) / max(speech_seconds, 0.1) * 60, 1),
                "long_pauses": 0, "target_wpm": [120, 170],
            },
            "tips": [],
        }


# ---------------------------------------------------------------------------- factory
_client_lock = threading.Lock()
_client: tuple[str, SpeechClient | FakeSpeechClient] | None = None


def get_speech_client() -> SpeechClient | FakeSpeechClient | None:
    """Configured client, or ``None`` when no speech service is configured (feature degrades)."""
    global _client
    provider = settings.normalized_speech_provider()
    base_url = settings.speech_base_url()
    key = f"{provider}|{base_url}|{settings.speech_api_token}|{settings.speech_timeout_seconds}"
    with _client_lock:
        if _client and _client[0] == key:
            return _client[1]
        if provider == "fake":
            client: SpeechClient | FakeSpeechClient = FakeSpeechClient()
        elif base_url:
            client = SpeechClient(base_url, settings.speech_api_token, settings.speech_timeout_seconds)
        else:
            _client = None
            return None
        _client = (key, client)
        return client


def reset_speech_client() -> None:
    global _client
    with _client_lock:
        _client = None
