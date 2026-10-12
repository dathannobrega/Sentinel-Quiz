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
from . import phonemes as phoneme_tools
from . import prosody as prosody_tools
from .alignment import AlignedWord, align, reference_words
from .cache import AudioCache, CachedAudio
from .config import Settings
from .engines.base import (
    ASREngine, DisabledASR, DisabledPhoneme, DisabledTTS, EngineDisabled, HeardWord, PhonemeEngine, TTSEngine,
)
from .engines.fake import FakeASR, FakePhoneme, FakeTTS
from .metrics import Metrics
from .scoring import compute, parse_weights, phoneme_tips, phoneme_tips_from_scores, speech_window
from .textnorm import compare_key, display_tokens, normalize_word

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

        return KokoroTTS(settings.tts_model, settings.tts_default_voice, settings.torch_threads)
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


def build_phoneme_engine(settings: Settings) -> PhonemeEngine:
    engine = settings.phoneme_engine.lower()
    if engine == "wav2vec2":
        from .engines.wav2vec2_phoneme import Wav2Vec2Phoneme

        return Wav2Vec2Phoneme(settings.phoneme_model, settings.phoneme_threads)
    if engine == "fake":
        return FakePhoneme("fake")
    if engine == "none":
        return DisabledPhoneme(settings.phoneme_model)
    raise ValueError(f"unknown SPEECH_PHONEME_ENGINE: {settings.phoneme_engine}")


def _sound_key(ipa: str | None) -> str:
    """IPA without stress, ties or spaces: two words with the same key sound the same."""
    if not ipa:
        return ""
    return "".join(ch for ch in ipa if ch not in "ˈˌ \u200d^-")


def audio_id_for(engine: str, model: str, voice: str, speed: float, lang: str, text: str) -> str:
    """Stable id: the same request never synthesizes twice (contract §5.1)."""
    key = "\x1f".join([engine, model, voice, f"{speed:.3f}", lang.lower(), text])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


class SpeechService:
    def __init__(
        self, settings: Settings, tts: TTSEngine | None = None, asr: ASREngine | None = None,
        phoneme: PhonemeEngine | None = None,
    ) -> None:
        self.settings = settings
        self.tts = tts or build_tts_engine(settings)
        self.asr = asr or build_asr_engine(settings)
        self.phoneme = phoneme or build_phoneme_engine(settings)
        self.cache = AudioCache(settings.cache_path, settings.cache_max_mb * 1024 * 1024)
        self.metrics = Metrics()
        self.weights = parse_weights(settings.score_weights)
        # The phoneme pass runs inside an assess call (already holding an ASR slot); its
        # own semaphore bounds concurrent wav2vec2 forwards. On timeout the assessment
        # goes out without phonemes instead of failing.
        self._phoneme_slots = threading.BoundedSemaphore(max(1, settings.max_concurrency))
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
            # Last: TTS + ASR are what make the service "ok"; phonemes are optional.
            if self.phoneme.name != "none":
                try:
                    self.phoneme.load()
                    logger.info("phoneme engine %s/%s ready", self.phoneme.name, self.phoneme.model)
                except Exception as exc:  # noqa: BLE001
                    logger.error("phoneme engine %s failed to load: %s", self.phoneme.name, exc)

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
            # Optional: never part of the overall status (assessments then go out
            # without phonemes and with engines.phoneme = null).
            "phoneme": {
                "engine": self.phoneme.name,
                "model": self.phoneme.model,
                "ready": bool(self.phoneme.ready),
                "error": getattr(self.phoneme, "error", None),
            },
        }

    def metrics_payload(self) -> bytes:
        try:
            cache_bytes = self.cache.total_bytes()
        except OSError:
            cache_bytes = 0
        return self.metrics.render([self.tts, self.asr, self.phoneme], cache_bytes)

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
            with self.metrics.time_inference(self.tts.name):
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
            with self.metrics.time_inference(self.asr.name):
                heard = self.asr.transcribe(pcm, reference_text=reference_text, raw_bytes=audio_bytes)
        except EngineDisabled as exc:
            raise ServiceError(503, "engine_disabled", str(exc)) from exc

        refs = reference_words(reference_text)
        words, extras = align(refs, heard, weak_confidence=self.settings.weak_confidence)
        self._rescue_homophones(words, lang)
        phoneme_active = self._phoneme_pass(pcm, heard, words)
        if not phoneme_active:
            for word in words:
                if word.status in {"weak", "mispronounced"}:
                    word.expected_ipa = g2p.to_standard_ipa(g2p.ipa(word.text, lang="en-us"))
                    if word.status == "mispronounced" and word.heard:
                        word.heard_ipa = g2p.to_standard_ipa(g2p.ipa(word.heard, lang="en-us"))

        prosody, breaks = prosody_tools.analyze(
            pcm, audio_tools.ASR_SAMPLE_RATE,
            [prosody_tools.TimedWord(w.index, w.char_start, w.char_end, w.start, w.end) for w in words],
            reference_text, len(heard), window=speech_window(heard),
        )
        for word in words:
            word.brk = breaks.get(word.index)
        scores, metrics = compute(
            words, extras, heard, text=reference_text, prosody=None if prosody is None else prosody["score"],
            weights=self.weights, phoneme_active=phoneme_active,
        )
        speech_seconds = metrics.pop("speech_seconds")
        if not self.asr.needs_decoded_audio and heard:
            duration = round(max(w.end for w in heard), 3)
        return {
            "engine": self.asr.name,
            "model": self.asr.model,
            "engines": {"asr": self.asr.name, "phoneme": self.phoneme.name if phoneme_active else None},
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
                    "reason": w.reason,
                    "heard": w.heard,
                    "confidence": w.confidence,
                    "start": w.start,
                    "end": w.end,
                    "expected_ipa": w.expected_ipa,
                    "heard_ipa": w.heard_ipa,
                    "phoneme_score": w.phoneme_score,
                    "phonemes": w.phonemes,
                    "break": w.brk,
                }
                for w in words
            ],
            "extras": [{"text": e.text, "after_index": e.after_index, "start": e.start, "end": e.end} for e in extras],
            "scores": scores.as_dict(),
            "prosody": prosody,
            "metrics": metrics,
            "tips": phoneme_tips_from_scores(words) if phoneme_active else phoneme_tips(words),
        }

    # ------------------------------------------------------------ assess helpers
    def _sound_keys(self, texts: list[str], lang: str) -> list[str]:
        if phoneme_tools.espeak_path() is not None:
            try:
                return [_sound_key(x) for x in phoneme_tools.espeak_words(texts, lang)]
            except Exception as exc:  # noqa: BLE001
                logger.debug("espeak unavailable for homophones: %s", exc)
        return [_sound_key(g2p.to_standard_ipa(g2p.ipa(t, lang))) for t in texts]

    def _rescue_homophones(self, words: list[AlignedWord], lang: str) -> None:
        """A substitution that sounds identical in US or UK English (phishing/fishing,
        recognise/recognize, two/too, flaw/floor in RP) is not a mispronunciation:
        Whisper just picked another spelling."""
        subs = [w for w in words if w.status == "mispronounced" and w.reason == "substitution" and w.heard]
        if not subs:
            return
        texts: list[str] = []
        for w in subs:
            texts += [normalize_word(w.text), w.heard or ""]
        # Both accents: "flaw"/"floor" sound the same in non-rhotic British English.
        accents = [self._sound_keys(texts, "en-us"), self._sound_keys(texts, "en-gb")]
        for k, word in enumerate(subs):
            same = any(keys[2 * k] and keys[2 * k] == keys[2 * k + 1] for keys in accents)
            if same and compare_key(normalize_word(word.text)) != compare_key(word.heard or ""):
                low = word.confidence is not None and word.confidence < self.settings.weak_confidence
                word.status, word.reason = ("weak", "low_confidence") if low else ("ok", None)

    def _phoneme_ready(self) -> bool:
        engine = self.phoneme
        if engine.name == "none":
            return False
        if engine.ready:
            return True
        if getattr(engine, "loading", False) or getattr(engine, "error", None):
            return False
        if self.settings.preload and engine.name != "fake":
            return False  # the preload thread will get there; do not block this request
        try:
            engine.load()
        except Exception as exc:  # noqa: BLE001
            logger.warning("phoneme engine failed to load: %s", exc)
            return False
        return engine.ready

    def _phoneme_pass(self, pcm: np.ndarray, heard: list[HeardWord], words: list[AlignedWord]) -> bool:
        """Fill phonemes/phoneme_score/IPA and apply the ``phoneme`` status override."""
        if not heard or not self._phoneme_ready():
            return False
        if not self._phoneme_slots.acquire(timeout=self.settings.busy_wait_seconds):
            logger.warning("phoneme slots busy; assessment goes out without phonemes")
            return False
        try:
            with self.metrics.time_inference(self.phoneme.name):
                post = self.phoneme.posteriors(pcm, heard)
            expected = self.phoneme.expected([normalize_word(w.text) for w in words])
        except Exception as exc:  # noqa: BLE001
            logger.warning("phoneme scoring skipped: %s", exc)
            return False
        finally:
            self._phoneme_slots.release()
        targets = [k for k, w in enumerate(words) if w.status != "missed" and w.start is not None and expected[k]]
        results = phoneme_tools.score_words(
            post, [(float(words[k].start), float(words[k].end), expected[k]) for k in targets]  # type: ignore[arg-type]
        )
        scored = dict(zip(targets, results))
        threshold = self.settings.phoneme_word_threshold
        for k, word in enumerate(words):
            result = scored.get(k)
            if result is None:
                word.expected_ipa = expected[k][0].ipa if expected[k] else None
                continue
            word.expected_ipa = result.expected_ipa
            word.heard_ipa = result.heard_ipa
            word.phoneme_score = round(result.score, 3)
            word.phonemes = [p.as_dict() for p in result.phonemes]
            if word.status in {"ok", "weak"} and result.score < threshold:
                word.status, word.reason = "mispronounced", "phoneme"
        return True

    # ------------------------------------------------------------------------ G2P
    def g2p(self, words: list[str], lang: str) -> list[dict[str, Any]]:
        """Standard IPA per word (espeak-ng, misaki as fallback); ``None`` on failure."""
        cleaned = [w.strip() for w in words]
        raw: list[str | None] = [None] * len(cleaned)
        if phoneme_tools.espeak_path() is not None:
            try:
                raw = [phoneme_tools.display_ipa(r) if r else None for r in phoneme_tools.espeak_words(cleaned, lang)]
            except Exception as exc:  # noqa: BLE001
                logger.warning("espeak-ng g2p failed: %s", exc)
        out = []
        for word, value in zip(words, raw):
            if value is None and word.strip():
                value = g2p.to_standard_ipa(g2p.ipa(word.strip(), lang=lang))
            out.append({"word": word, "ipa": value or None})
        return out


__all__ = ["SpeechService", "ServiceError", "TTSOutput", "audio_id_for", "display_tokens"]
