"""Orchestration: TTS with cache, and assessment (decode -> ASR -> align -> score).

Blocking by design: the API layer runs these in a thread pool under per-engine
semaphores. Keeping the service synchronous makes it trivially testable and keeps
all torch/CTranslate2 work off the event loop.
"""
from __future__ import annotations

import hashlib
import logging
import threading
from dataclasses import dataclass
from typing import Any

import numpy as np

from . import audio as audio_tools
from . import g2p
from .alignment import align, reference_words
from .cache import AudioCache, CachedAudio
from .config import Settings
from .engines.base import ASREngine, DisabledASR, DisabledTTS, EngineDisabled, TTSEngine
from .engines.fake import FakeASR, FakeTTS
from .scoring import compute, phoneme_tips
from .textnorm import display_tokens

logger = logging.getLogger("speech.service")


class ServiceError(Exception):
    """Business error mapped to an HTTP status + code by the API layer."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(slots=True)
class TTSOutput:
    audio_id: str
    content_type: str
    duration_seconds: float
    sample_rate: int
    cached: bool
    engine: str
    model: str
    voice: str
    speed: float
    lang: str
    words: list[dict[str, Any]]
    text: str


def build_tts_engine(settings: Settings) -> TTSEngine:
    engine = settings.tts_engine.lower()
    if engine == "kokoro":
        from .engines.kokoro_tts import KokoroTTS

        return KokoroTTS(settings.tts_model, settings.tts_default_voice)
    if engine == "fake":
        return FakeTTS(settings.tts_model)
    if engine == "none":
        return DisabledTTS(settings.tts_model)
    raise ValueError(f"unknown SPEECH_TTS_ENGINE: {settings.tts_engine}")


def build_asr_engine(settings: Settings) -> ASREngine:
    engine = settings.asr_engine.lower()
    if engine == "faster-whisper":
        from .engines.faster_whisper_asr import FasterWhisperASR

        return FasterWhisperASR(settings.asr_model, settings.asr_compute_type, settings.asr_threads)
    if engine == "mlx-whisper":
        from .engines.mlx_whisper_asr import MlxWhisperASR

        return MlxWhisperASR(settings.asr_model)
    if engine == "fake":
        return FakeASR(settings.asr_model)
    if engine == "none":
        return DisabledASR(settings.asr_model)
    raise ValueError(f"unknown SPEECH_ASR_ENGINE: {settings.asr_engine}")


def audio_id_for(engine: str, model: str, voice: str, speed: float, lang: str, text: str) -> str:
    """Stable id: the same request never synthesizes twice (contract §5.1)."""
    key = "\x1f".join([engine, model, voice, f"{speed:.3f}", lang.lower(), text])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


class SpeechService:
    def __init__(self, settings: Settings, tts: TTSEngine | None = None, asr: ASREngine | None = None) -> None:
        self.settings = settings
        self.tts = tts or build_tts_engine(settings)
        self.asr = asr or build_asr_engine(settings)
        self.cache = AudioCache(settings.cache_path, settings.cache_max_mb * 1024 * 1024)
        self._preload_thread: threading.Thread | None = None
        self.audio_format = settings.audio_format.lower()
        if self.audio_format == "mp3" and not audio_tools.ffmpeg_available():
            logger.warning("ffmpeg not found: falling back to WAV output and ASR uploads will fail to decode")
            self.audio_format = "wav"

    # ------------------------------------------------------------------ lifecycle
    def preload(self) -> None:
        """Load both engines in a background thread (SPEECH_PRELOAD=true)."""

        def _load() -> None:
            for label, engine in (("tts", self.tts), ("asr", self.asr)):
                if engine.name == "none":
                    continue
                try:
                    engine.load()
                    logger.info("%s engine %s/%s ready", label, engine.name, engine.model)
                except Exception as exc:  # noqa: BLE001
                    logger.error("%s engine %s failed to load: %s", label, engine.name, exc)
            if self.asr.name not in {"none", "fake"}:
                g2p.warm()

        self._preload_thread = threading.Thread(target=_load, name="speech-preload", daemon=True)
        self._preload_thread.start()

    @property
    def warming(self) -> bool:
        return any(getattr(e, "loading", False) for e in (self.tts, self.asr))

    def health(self) -> dict[str, Any]:
        enabled = [e for e in (self.tts, self.asr) if e.name != "none"]
        status = "ok"
        if any(getattr(e, "error", None) for e in enabled):
            status = "degraded"
        elif any(not e.ready for e in enabled):
            status = "warming"
        return {
            "status": status,
            "tts": {
                "engine": self.tts.name,
                "model": self.tts.model,
                "ready": bool(self.tts.ready),
                "voices": self.settings.voice_catalog,
                "default_voice": self.settings.tts_default_voice,
                "format": self.audio_format,
                "error": getattr(self.tts, "error", None),
            },
            "asr": {
                "engine": self.asr.name,
                "model": self.asr.model,
                "ready": bool(self.asr.ready),
                "error": getattr(self.asr, "error", None),
            },
        }

    def _ensure_ready(self, engine: TTSEngine | ASREngine) -> None:
        if engine.name == "none":
            raise ServiceError(503, "engine_disabled", f"{engine.name} engine is disabled")
        if engine.ready:
            return
        if getattr(engine, "loading", False):
            raise ServiceError(503, "model_not_ready", "model is still loading")
        if getattr(engine, "error", None):
            raise ServiceError(503, "model_not_ready", f"model failed to load: {engine.error}")
        # No preload: the first request loads the model (others block on the loader lock).
        try:
            engine.load()
        except Exception as exc:  # noqa: BLE001
            raise ServiceError(503, "model_not_ready", f"model failed to load: {exc}") from exc

    # ------------------------------------------------------------------------ TTS
    def validate_text(self, text: str | None) -> str:
        if text is None or not text.strip():
            raise ServiceError(400, "text_required", "text is required")
        if len(text) > self.settings.max_text_chars:
            raise ServiceError(400, "text_too_long", f"text exceeds {self.settings.max_text_chars} characters")
        return text

    def validate_voice(self, voice: str | None) -> str:
        voice = voice or self.settings.tts_default_voice
        if voice not in self.settings.voices:
            raise ServiceError(400, "voice_invalid", f"unknown voice: {voice}")
        return voice

    def tts_audio_id(self, text: str, voice: str, speed: float, lang: str) -> str:
        return audio_id_for(self.tts.name, self.tts.model, voice, speed, lang, text)

    def cached_tts(self, audio_id: str) -> TTSOutput | None:
        hit = self.cache.get(audio_id)
        return None if hit is None else self._output_from_cache(hit, cached=True)

    def synthesize(self, text: str, voice: str, speed: float, lang: str) -> TTSOutput:
        """Blocking synthesis + encode + cache. Caller checked the cache already."""
        audio_id = self.tts_audio_id(text, voice, speed, lang)
        self._ensure_ready(self.tts)
        try:
            result = self.tts.synthesize(text, voice, speed, lang)
        except EngineDisabled as exc:
            raise ServiceError(503, "engine_disabled", str(exc)) from exc
        if self.audio_format == "mp3":
            payload = audio_tools.encode_mp3(result.audio_f32, result.sample_rate)
        else:
            payload = audio_tools.encode_wav(result.audio_f32, result.sample_rate)
        words = [
            {"text": w.text, "start": round(w.start, 3), "end": round(w.end, 3), "char_start": w.char_start, "char_end": w.char_end}
            for w in result.words
        ]
        meta = {
            "audio_id": audio_id,
            "engine": self.tts.name,
            "model": self.tts.model,
            "voice": voice,
            "speed": speed,
            "lang": lang,
            "text": text,
            "duration_seconds": round(result.duration, 3),
            "sample_rate": result.sample_rate,
            "words": words,
        }
        hit = self.cache.put(audio_id, payload, self.audio_format, meta)
        return self._output_from_cache(hit, cached=False)

    @staticmethod
    def _output_from_cache(hit: CachedAudio, cached: bool) -> TTSOutput:
        m = hit.meta
        return TTSOutput(
            audio_id=hit.audio_id,
            content_type=hit.content_type,
            duration_seconds=float(m.get("duration_seconds", 0.0)),
            sample_rate=int(m.get("sample_rate", 24_000)),
            cached=cached,
            engine=str(m.get("engine", "")),
            model=str(m.get("model", "")),
            voice=str(m.get("voice", "")),
            speed=float(m.get("speed", 1.0)),
            lang=str(m.get("lang", "en-us")),
            words=list(m.get("words", [])),
            text=str(m.get("text", "")),
        )

    def audio_file(self, audio_id: str) -> CachedAudio | None:
        return self.cache.get(audio_id)

    # --------------------------------------------------------------------- assess
    def assess(self, audio_bytes: bytes, content_type: str | None, reference_text: str, lang: str) -> dict[str, Any]:
        """Blocking assessment. The recording lives only in memory for this call."""
        reference_text = self.validate_text(reference_text)
        if not audio_bytes:
            raise ServiceError(400, "audio_invalid", "audio is empty")
        if len(audio_bytes) > self.settings.max_audio_bytes:
            raise ServiceError(413, "audio_too_large", f"audio exceeds {self.settings.max_audio_bytes} bytes")
        self._ensure_ready(self.asr)

        duration = 0.0
        pcm = np.zeros(0, dtype=np.float32)
        if self.asr.needs_decoded_audio:
            try:
                pcm = audio_tools.decode_to_f32(audio_bytes, audio_tools.ASR_SAMPLE_RATE)
            except audio_tools.AudioDecodeError as exc:
                raise ServiceError(400, "audio_invalid", f"could not decode audio ({content_type or 'unknown type'}): {exc}") from exc
            duration = audio_tools.duration_seconds(pcm, audio_tools.ASR_SAMPLE_RATE)
        try:
            heard = self.asr.transcribe(pcm, reference_text=reference_text, raw_bytes=audio_bytes)
        except EngineDisabled as exc:
            raise ServiceError(503, "engine_disabled", str(exc)) from exc

        refs = reference_words(reference_text)
        words, extras = align(refs, heard)
        for word in words:
            if word.status in {"weak", "mispronounced"}:
                word.expected_ipa = g2p.ipa(word.text, lang="en-us")
                if word.status == "mispronounced" and word.heard:
                    word.heard_ipa = g2p.ipa(word.heard, lang="en-us")
        scores, metrics = compute(words, extras, heard)
        speech_seconds = metrics.pop("speech_seconds")
        if not self.asr.needs_decoded_audio and heard:
            duration = round(max(w.end for w in heard), 3)
        return {
            "engine": self.asr.name,
            "model": self.asr.model,
            "duration_seconds": duration,
            "speech_seconds": speech_seconds,
            "transcript": " ".join(w.text for w in heard),
            "text": reference_text,
            "words": [
                {
                    "index": w.index,
                    "text": w.text,
                    "char_start": w.char_start,
                    "char_end": w.char_end,
                    "status": w.status,
                    "heard": w.heard,
                    "confidence": w.confidence,
                    "start": w.start,
                    "end": w.end,
                    "expected_ipa": w.expected_ipa,
                    "heard_ipa": w.heard_ipa,
                }
                for w in words
            ],
            "extras": [{"text": e.text, "after_index": e.after_index, "start": e.start, "end": e.end} for e in extras],
            "scores": scores.as_dict(),
            "metrics": metrics,
            "tips": phoneme_tips(words),
        }


__all__ = ["SpeechService", "ServiceError", "TTSOutput", "audio_id_for", "display_tokens"]
