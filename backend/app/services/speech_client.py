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
import json
import math
import re
import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import httpx

from app.core.config import settings
from app.services.material_corpus import sentence_spans

HEALTH_CACHE_SECONDS = 30.0
AUDIO_ID_RE = re.compile(r"^[0-9a-f]{64}$")
# Increment 3 (§2.3): ``X-Speech-Priority``. Warm-up requests are ``low`` and never delay a reader.
PRIORITIES = ("normal", "low")

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
    # Increment 2 (§2.6): the phoneme engine may still be warming while TTS/ASR are ready.
    phoneme: dict[str, Any] = field(default_factory=dict)
    # Increment 3 (§2.4): effective CPUs, threads and concurrency the service settled on.
    runtime: dict[str, Any] = field(default_factory=dict)

    @property
    def tts_ready(self) -> bool:
        return bool(self.tts.get("ready")) and str(self.tts.get("engine") or "none") != "none"

    @property
    def asr_ready(self) -> bool:
        return bool(self.asr.get("ready")) and str(self.asr.get("engine") or "none") != "none"

    @property
    def phoneme_ready(self) -> bool:
        return bool(self.phoneme.get("ready")) and str(self.phoneme.get("engine") or "none") != "none"


UNAVAILABLE = SpeechHealth(status="unavailable", tts={"engine": None, "ready": False}, asr={"engine": None, "ready": False})


def _voice_lang(voice: str) -> str:
    return "en-gb" if str(voice or "").startswith("b") else "en-us"


class SpeechClient:
    """Thin synchronous HTTP client (the API is sync SQLAlchemy code; calls run in the threadpool)."""

    def __init__(self, base_url: str, token: str = "", timeout_seconds: float = 60.0, stream_timeout_seconds: float = 300.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._token = token.strip()
        self._timeout = httpx.Timeout(timeout=timeout_seconds, connect=5.0, read=timeout_seconds, write=timeout_seconds)
        # A whole block streamed sentence by sentence on a small VM can take minutes; the read
        # timeout applies between lines, not to the whole body.
        self._stream_timeout = httpx.Timeout(timeout=stream_timeout_seconds, connect=5.0, read=stream_timeout_seconds, write=stream_timeout_seconds)
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
                phoneme=dict(body.get("phoneme") or {}),
                runtime=dict(body.get("runtime") or {}),
            )
        except Exception:
            health = UNAVAILABLE
        with self._health_lock:
            self._health_cache = (now, health)
        return health

    @staticmethod
    def _priority_headers(priority: str) -> dict[str, str]:
        return {"X-Speech-Priority": priority if priority in PRIORITIES else "normal"}

    def tts(self, text: str, *, voice: str, speed: float, priority: str = "normal") -> dict[str, Any]:
        response = self._request(
            "POST",
            "/v1/tts",
            json={"text": text, "voice": voice, "speed": speed, "lang": _voice_lang(voice)},
            headers=self._priority_headers(priority),
        )
        return response.json()

    def _async_client(self) -> httpx.AsyncClient:
        """One client per stream (tests swap in a mock transport here)."""
        return httpx.AsyncClient(base_url=self.base_url, timeout=self._stream_timeout, headers=self._headers())

    async def tts_stream(self, text: str, *, voice: str, speed: float, priority: str = "normal") -> AsyncIterator[str]:
        """NDJSON lines of ``POST /v1/tts/stream`` (§2.2) as the service emits them.

        A failure before the first line raises :class:`SpeechError` (the API still owes the client a
        JSON status); a failure after it raises too, and the API turns it into an ``error`` line
        because the 200 is already on the wire.
        """
        body = {"text": text, "voice": voice, "speed": speed, "lang": _voice_lang(voice)}
        try:
            async with self._async_client() as client:
                async with client.stream("POST", "/v1/tts/stream", json=body, headers=self._priority_headers(priority)) as response:
                    if response.status_code >= 400:
                        await response.aread()
                        self._raise_for(response)
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if line:
                            yield line
        except httpx.TimeoutException as exc:
            raise SpeechError(504, "speech_timeout", "Speech service timed out.") from exc
        except httpx.HTTPError as exc:
            raise SpeechError(503, "speech_unavailable", "Speech service is unavailable.") from exc

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

    def g2p(self, words: list[str], *, lang: str = "en-us") -> dict[str, str | None]:
        """IPA per word (``/v1/g2p``, §2.6); ``None`` for a word the service could not convert."""
        wanted = _g2p_words(words)
        if not wanted:
            return {}
        response = self._request("POST", "/v1/g2p", json={"words": wanted, "lang": lang})
        out: dict[str, str | None] = {word: None for word in wanted}
        for item in (response.json() or {}).get("items") or []:
            word = str(item.get("word") or "")
            if word in out:
                ipa = item.get("ipa")
                out[word] = str(ipa) if ipa else None
        return out


G2P_MAX_WORDS = 50
G2P_MAX_CHARS = 64


def _g2p_words(words: list[str]) -> list[str]:
    seen: list[str] = []
    for word in words:
        word = str(word or "").strip()
        if word and len(word) <= G2P_MAX_CHARS and word not in seen:
            seen.append(word)
    return seen[:G2P_MAX_WORDS]


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


# Grapheme -> pseudo-IPA for the fake engines (deterministic, not linguistics).
_FAKE_GRAPHEMES: tuple[tuple[str, str], ...] = (
    ("tion", "ʃən"), ("th", "θ"), ("sh", "ʃ"), ("ch", "tʃ"), ("ph", "f"), ("ee", "iː"), ("oo", "uː"),
    ("ck", "k"), ("ng", "ŋ"), ("a", "æ"), ("e", "ɛ"), ("i", "ɪ"), ("o", "ɑ"), ("u", "ʌ"), ("y", "i"),
    ("c", "k"), ("q", "k"), ("x", "ks"), ("j", "dʒ"), ("r", "ɹ"),
)


def _fake_phonemes(word: str) -> list[str]:
    text = re.sub(r"[^a-z]", "", _normalize(word))
    out: list[str] = []
    index = 0
    while index < len(text):
        for grapheme, phone in _FAKE_GRAPHEMES:
            if text.startswith(grapheme, index):
                out.append(phone)
                index += len(grapheme)
                break
        else:
            out.append(text[index])
            index += 1
    return out[:16]


def _fake_ipa(word: str) -> str | None:
    phones = _fake_phonemes(word)
    return "ˈ" + "".join(phones) if phones else None


# Transcript markers understood by the fake assessment (prefix of a word of the FAKE: payload).
_FAKE_PHONEME_ERROR = "~"   # word heard but badly pronounced -> mispronounced, reason "phoneme"
_FAKE_HESITATION = "?"      # word heard with low confidence -> weak, reason "low_confidence"
_FAKE_WEIGHTS = {"accuracy": 0.5, "completeness": 0.2, "fluency": 0.15, "prosody": 0.15}


def _fake_phoneme_detail(word: str, quality: str) -> tuple[list[dict[str, Any]], float | None]:
    """Per-phoneme scores: all good, or the first phoneme ``bad`` and the rest ``fair``."""
    phones = _fake_phonemes(word)
    if not phones:
        return [], None
    detail = []
    for index, phone in enumerate(phones):
        if quality == "good":
            score, heard, label = 0.92, phone, "good"
        elif quality == "weak":
            score, heard, label = 0.55, phone, "fair"
        elif index == 0:
            score, heard, label = 0.2, ("t" if phone != "t" else "d"), "bad"
        else:
            score, heard, label = 0.5, phone, "fair"
        detail.append({"ipa": phone, "score": score, "heard": heard, "quality": label})
    return detail, round(sum(item["score"] for item in detail) / len(detail), 3)


class FakeSpeechClient:
    """Deterministic stand-in: evenly spaced word timings; assessment driven by a ``FAKE:`` payload.

    When the uploaded "audio" is UTF-8 text starting with ``FAKE:``, the remainder is the
    transcript (words missing from it are ``missed``, words not in the reference are ``extras``).
    A transcript word prefixed with ``~`` (``FAKE:security ~awareness``) comes back
    ``mispronounced`` with ``reason: "phoneme"`` and a low ``phoneme_score``; with ``?`` it is
    ``weak`` (``low_confidence``). Any other payload is treated as a perfect reading. The
    response carries every Increment 2 field (§2.5) so the UI and the E2E can exercise them.
    """

    base_url = "fake://speech"

    def __init__(self) -> None:
        self._audio: dict[str, tuple[bytes, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    # Mirrors ``/healthz.runtime`` of the real service (Increment 3 §2.4) so the UI and the E2E see it.
    runtime: dict[str, Any] = {
        "effective_cpus": 2, "threads": {"asr": 2, "torch": 2, "phoneme": 2}, "max_concurrency": 1, "parallel_phonemes": False,
    }

    def health(self, *, force: bool = False) -> SpeechHealth:
        voices = [dict(voice) for voice in DEFAULT_VOICES]
        return SpeechHealth(
            status="ok",
            tts={"engine": "fake", "model": "fake", "ready": True, "voices": voices, "default_voice": "af_heart"},
            asr={"engine": "fake", "model": "fake", "ready": True},
            phoneme={"engine": "fake", "model": "fake", "ready": True},
            runtime=dict(self.runtime),
        )

    @staticmethod
    def _words(text: str) -> list[dict[str, Any]]:
        matches = list(_WORD_RE.finditer(text))
        step = 0.3
        return [
            {"text": m.group(0), "start": round(i * step, 3), "end": round(i * step + 0.25, 3), "char_start": m.start(), "char_end": m.end()}
            for i, m in enumerate(matches)
        ]

    @staticmethod
    def _audio_id(voice: str, speed: float, text: str) -> str:
        return hashlib.sha256(f"fake|{voice}|{speed}|{text}".encode("utf-8")).hexdigest()

    def _store(self, audio_id: str, duration: float, words: list[dict[str, Any]]) -> bool:
        """Register fake audio; ``True`` when it was already there (= ``cached``)."""
        with self._lock:
            cached = audio_id in self._audio
            if not cached:
                self._audio[audio_id] = (_wav_bytes(min(duration, 2.0)), {"words": words})
        return cached

    def tts(self, text: str, *, voice: str, speed: float, priority: str = "normal") -> dict[str, Any]:
        words = self._words(text)
        duration = round(len(words) * 0.3 / max(speed, 0.1), 3)
        audio_id = self._audio_id(voice, speed, text)
        cached = self._store(audio_id, duration, words)
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
            "priority": priority,
        }

    async def tts_stream(self, text: str, *, voice: str, speed: float, priority: str = "normal") -> AsyncIterator[str]:
        """Sentence-by-sentence NDJSON like the real ``/v1/tts/stream`` (§2.2), deterministically.

        Sentences follow :func:`sentence_spans` (the corpus rule); each gets its own audio id,
        downloadable through :meth:`audio`, and ``cached`` turns true once it has been served.
        Word offsets are relative to the block, timings relative to the sentence's audio.
        """
        spans = sentence_spans(text) or [(0, len(text))]
        segments: list[dict[str, Any]] = []
        total = 0.0
        for index, (start, end) in enumerate(spans):
            sentence = text[start:end]
            words = self._words(sentence)
            for word in words:
                word["char_start"] += start
                word["char_end"] += start
            duration = round(len(words) * 0.3 / max(speed, 0.1), 3)
            audio_id = self._audio_id(voice, speed, sentence)
            cached = self._store(audio_id, duration, words)
            total += duration
            segments.append({
                "type": "segment", "index": index, "audio_id": audio_id, "char_start": start, "char_end": end,
                "duration_seconds": duration, "cached": cached, "words": words,
            })
        meta = {
            "type": "meta", "block_audio_id": self._audio_id(voice, speed, text), "sentences": len(segments),
            "engine": "fake", "model": "fake", "voice": voice, "speed": speed, "lang": _voice_lang(voice),
            "content_type": "audio/wav", "priority": priority,
        }
        yield json.dumps(meta, ensure_ascii=False)
        for segment in segments:
            yield json.dumps(segment, ensure_ascii=False)
        yield json.dumps({"type": "done", "duration_seconds": round(total, 3)})

    def audio(self, audio_id: str) -> tuple[bytes, str]:
        with self._lock:
            entry = self._audio.get(audio_id)
        if entry is None:
            raise SpeechError(404, "audio_not_found", "Audio not found.")
        return entry[0], "audio/wav"

    def g2p(self, words: list[str], *, lang: str = "en-us") -> dict[str, str | None]:
        return {word: _fake_ipa(word) for word in _g2p_words(words)}

    @staticmethod
    def _transcript(audio: bytes) -> tuple[list[str], dict[str, str]] | None:
        """Heard words (normalized) and the marker of each marked word, or ``None`` = perfect."""
        if not audio.startswith(b"FAKE:"):
            return None
        heard: list[str] = []
        marks: dict[str, str] = {}
        for token in audio[5:].decode("utf-8", "ignore").split():
            mark = token[0] if token[0] in (_FAKE_PHONEME_ERROR, _FAKE_HESITATION) else ""
            for word in _WORD_RE.findall(token[1:] if mark else token):
                norm = _normalize(word)
                if not norm:
                    continue
                heard.append(norm)
                if mark:
                    marks[norm] = mark
        return heard, marks

    def assess(self, audio: bytes, *, content_type: str, filename: str, reference_text: str) -> dict[str, Any]:
        reference = self._words(reference_text)
        parsed = self._transcript(audio)
        heard_pool = list(parsed[0]) if parsed is not None else None
        marks = parsed[1] if parsed is not None else {}
        words: list[dict[str, Any]] = []
        counts = {"ok": 0, "weak": 0, "mispronounced": 0, "missed": 0}
        word_acc: list[float] = []
        tips: list[dict[str, Any]] = []
        for index, word in enumerate(reference):
            norm = _normalize(word["text"])
            heard_it = heard_pool is None or norm in heard_pool
            if heard_it and heard_pool is not None:
                heard_pool.remove(norm)
            mark = marks.get(norm) if heard_it else None
            if not heard_it:
                status, reason, confidence = "missed", None, None
                phonemes, phoneme_score = None, None
            elif mark == _FAKE_PHONEME_ERROR:
                status, reason, confidence = "mispronounced", "phoneme", 0.9
                phonemes, phoneme_score = _fake_phoneme_detail(word["text"], "bad")
            elif mark == _FAKE_HESITATION:
                status, reason, confidence = "weak", "low_confidence", 0.45
                phonemes, phoneme_score = _fake_phoneme_detail(word["text"], "weak")
            else:
                status, reason, confidence = "ok", None, 0.95
                phonemes, phoneme_score = _fake_phoneme_detail(word["text"], "good")
            counts[status] += 1
            word_acc.append(0.0 if status == "missed" else (phoneme_score if phoneme_score is not None else 1.0))
            expected_ipa = _fake_ipa(word["text"])
            heard_ipa = "".join(p["heard"] for p in phonemes) if phonemes else None
            if status == "mispronounced" and phonemes:
                # One tip per sound pair (like the real service), examples deduplicated.
                bad = phonemes[0]
                tip = next((t for t in tips if (t["expected"], t["heard"]) == (bad["ipa"], bad["heard"])), None)
                if tip is None and len(tips) < 3:
                    tips.append({"code": "phoneme_confusion", "expected": bad["ipa"], "heard": bad["heard"], "examples": [word["text"]]})
                elif tip is not None and word["text"] not in tip["examples"] and len(tip["examples"]) < 3:
                    tip["examples"].append(word["text"])
            words.append({
                "index": index, "text": word["text"], "char_start": word["char_start"], "char_end": word["char_end"],
                "status": status, "reason": reason, "heard": norm if heard_it else None, "confidence": confidence,
                "start": word["start"] if heard_it else None, "end": word["end"] if heard_it else None,
                "expected_ipa": expected_ipa, "heard_ipa": heard_ipa,
                "phoneme_score": phoneme_score, "phonemes": phonemes or None, "break": None,
            })
        extras = [{"text": w, "after_index": len(reference) - 1, "start": None, "end": None} for w in (heard_pool or [])]
        total = max(len(reference), 1)
        heard_count = len(reference) - counts["missed"]
        accuracy = sum(word_acc) / total
        completeness = heard_count / total
        fluency = max(0.0, 1.0 - 0.05 * len(extras))
        prosody = None
        if heard_count >= 3:
            prosody = {"score": 0.9, "pitch_range_semitones": 3.2, "monotone": False, "unexpected_breaks": 0, "missing_breaks": 0}
        parts = {"accuracy": accuracy, "completeness": completeness, "fluency": fluency}
        if prosody is not None:
            parts["prosody"] = prosody["score"]
        weight = sum(_FAKE_WEIGHTS[key] for key in parts)
        overall = sum(_FAKE_WEIGHTS[key] * value for key, value in parts.items()) / weight
        scores = {key: round(value, 3) for key, value in parts.items()}
        scores.setdefault("prosody", None)
        scores["overall"] = round(overall, 3)
        speech_seconds = round(len(reference) * 0.3, 3)
        return {
            "engine": "fake",
            "model": "fake",
            "engines": {"asr": "fake", "phoneme": "fake"},
            "duration_seconds": speech_seconds + 0.5,
            "speech_seconds": speech_seconds,
            "transcript": " ".join(parsed[0]) if parsed is not None else reference_text,
            "words": words,
            "extras": extras,
            "scores": scores,
            "prosody": prosody,
            "metrics": {
                "reference_words": len(reference), "ok": counts["ok"], "weak": counts["weak"],
                "mispronounced": counts["mispronounced"], "missed": counts["missed"],
                "extra": len(extras), "wpm": round(len(reference) / max(speech_seconds, 0.1) * 60, 1),
                "long_pauses": 0, "target_wpm": [120, 170],
            },
            "tips": tips,
        }


# ---------------------------------------------------------------------------- factory
_client_lock = threading.Lock()
_client: tuple[str, SpeechClient | FakeSpeechClient] | None = None


def get_speech_client() -> SpeechClient | FakeSpeechClient | None:
    """Configured client, or ``None`` when no speech service is configured (feature degrades)."""
    global _client
    provider = settings.normalized_speech_provider()
    base_url = settings.speech_base_url()
    key = f"{provider}|{base_url}|{settings.speech_api_token}|{settings.speech_timeout_seconds}|{settings.speech_stream_timeout_seconds}"
    with _client_lock:
        if _client and _client[0] == key:
            return _client[1]
        if provider == "fake":
            client: SpeechClient | FakeSpeechClient = FakeSpeechClient()
        elif base_url:
            client = SpeechClient(
                base_url, settings.speech_api_token, settings.speech_timeout_seconds, float(settings.speech_stream_timeout_seconds)
            )
        else:
            _client = None
            return None
        _client = (key, client)
        return client


def reset_speech_client() -> None:
    global _client
    with _client_lock:
        _client = None
