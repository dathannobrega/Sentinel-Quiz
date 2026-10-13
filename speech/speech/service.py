"""Orchestration: TTS with cache, and assessment (decode -> ASR -> align -> score).

Blocking by design: the API layer runs these in a thread pool under per-engine
limiters. Keeping the service synchronous makes it trivially testable and keeps all
torch/CTranslate2 work off the event loop.

Contract 3 §2.1 makes the *sentence* the synthesis and cache unit: a block is split
with :func:`speech.textnorm.split_sentences`, each sentence is synthesized and cached
under its own ``audio_id`` and the block audio is the concatenation of the sentence
PCM, encoded once and cached under the same block ``audio_id`` as before. The disk cache
holds encoded audio, so block assembly needs the sentence PCM back: a small in-memory
LRU keeps the most recent sentences (the common case: a stream followed by the block
download) and otherwise the cached file is decoded (ffmpeg/soundfile, milliseconds).
Trade-off of decoding instead of re-synthesizing: a cached sentence is lossy MP3 at
64 kb/s mono, so the block carries a second generation of MP3 encoding (inaudible for
speech at this bitrate) but never costs a synthesis, which is what the contract
demands ("a block whose sentences are cached synthesizes nothing").
"""
from __future__ import annotations

import hashlib
import logging
import threading
from collections import OrderedDict
from collections.abc import Iterator
from concurrent.futures import Future, ThreadPoolExecutor
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
    ASREngine, DisabledASR, DisabledPhoneme, DisabledTTS, EngineDisabled, EngineError, HeardWord, PhonemeEngine, TTSEngine,
)
from .engines.base import Posteriors
from .engines.fake import FakeASR, FakePhoneme, FakeTTS
from .metrics import Metrics
from .runtime import RuntimeConfig, resolve_runtime
from .scoring import compute, parse_weights, phoneme_tips, phoneme_tips_from_scores, speech_window
from .textnorm import compare_key, display_tokens, normalize_word, split_sentences

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


@dataclass(slots=True)
class SentenceOutput:
    """One sentence of a block (contract 3 §2.1/§2.2).

    ``words[*].char_start/char_end`` index the *block* text; ``words[*].start/end`` are
    seconds into the sentence audio.
    """

    index: int
    audio_id: str
    char_start: int
    char_end: int
    text: str
    duration_seconds: float
    sample_rate: int
    cached: bool
    content_type: str
    words: list[dict[str, Any]]

    def as_segment(self) -> dict[str, Any]:
        return {
            "type": "segment",
            "index": self.index,
            "audio_id": self.audio_id,
            "char_start": self.char_start,
            "char_end": self.char_end,
            "duration_seconds": self.duration_seconds,
            "cached": self.cached,
            "words": self.words,
        }


class _PcmLRU:
    """Most recent sentence PCM by audio_id (thread-safe, bounded)."""

    def __init__(self, size: int) -> None:
        self.size = max(0, int(size))
        self._items: OrderedDict[str, tuple[np.ndarray, int]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, audio_id: str) -> tuple[np.ndarray, int] | None:
        with self._lock:
            item = self._items.get(audio_id)
            if item is not None:
                self._items.move_to_end(audio_id)
            return item

    def put(self, audio_id: str, pcm: np.ndarray, sample_rate: int) -> None:
        if self.size <= 0:
            return
        with self._lock:
            self._items[audio_id] = (pcm, sample_rate)
            self._items.move_to_end(audio_id)
            while len(self._items) > self.size:
                self._items.popitem(last=False)

    def __len__(self) -> int:
        return len(self._items)


def build_tts_engine(settings: Settings, runtime: RuntimeConfig | None = None) -> TTSEngine:
    runtime = runtime or resolve_runtime_from(settings)
    engine = settings.tts_engine.lower()
    if engine == "kokoro":
        from .engines.kokoro_tts import KokoroTTS

        return KokoroTTS(settings.tts_model, settings.tts_default_voice, runtime.torch_threads)
    if engine == "fake":
        return FakeTTS(settings.tts_model)
    if engine == "none":
        return DisabledTTS(settings.tts_model)
    raise ValueError(f"unknown SPEECH_TTS_ENGINE: {settings.tts_engine}")


def build_asr_engine(settings: Settings, runtime: RuntimeConfig | None = None) -> ASREngine:
    runtime = runtime or resolve_runtime_from(settings)
    engine = settings.asr_engine.lower()
    if engine == "faster-whisper":
        from .engines.faster_whisper_asr import FasterWhisperASR

        return FasterWhisperASR(settings.asr_model, settings.asr_compute_type, runtime.asr_threads)
    if engine == "mlx-whisper":
        from .engines.mlx_whisper_asr import MlxWhisperASR

        return MlxWhisperASR(settings.asr_model)
    if engine == "fake":
        return FakeASR(settings.asr_model)
    if engine == "none":
        return DisabledASR(settings.asr_model)
    raise ValueError(f"unknown SPEECH_ASR_ENGINE: {settings.asr_engine}")


def build_phoneme_engine(settings: Settings, runtime: RuntimeConfig | None = None) -> PhonemeEngine:
    runtime = runtime or resolve_runtime_from(settings)
    engine = settings.phoneme_engine.lower()
    if engine == "wav2vec2":
        from .engines.wav2vec2_phoneme import Wav2Vec2Phoneme

        return Wav2Vec2Phoneme(settings.phoneme_model, runtime.phoneme_threads)
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


def resolve_runtime_from(settings: Settings, cpus: int | None = None) -> RuntimeConfig:
    """Settings (``0`` = automatic) -> the threads/concurrency the engines really use."""
    return resolve_runtime(
        cpus=cpus,
        asr_threads=settings.asr_threads,
        torch_threads=settings.torch_threads,
        phoneme_threads=settings.phoneme_threads,
        max_concurrency=settings.max_concurrency,
        parallel_phonemes=settings.parallel_phonemes,
    )


def audio_id_for(engine: str, model: str, voice: str, speed: float, lang: str, text: str) -> str:
    """Stable id: the same request never synthesizes twice (contract §5.1)."""
    key = "\x1f".join([engine, model, voice, f"{speed:.3f}", lang.lower(), text])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


class SpeechService:
    def __init__(
        self, settings: Settings, tts: TTSEngine | None = None, asr: ASREngine | None = None,
        phoneme: PhonemeEngine | None = None, runtime: RuntimeConfig | None = None,
    ) -> None:
        self.settings = settings
        self.runtime = runtime or resolve_runtime_from(settings)
        logger.info(
            "runtime: effective_cpus=%d threads(asr=%d torch=%d phoneme=%d) max_concurrency=%d parallel_phonemes=%s (%s)",
            self.runtime.effective_cpus, self.runtime.asr_threads, self.runtime.torch_threads,
            self.runtime.phoneme_threads, self.runtime.max_concurrency, self.runtime.parallel_phonemes,
            self.runtime.parallel_mode,
        )
        self.tts = tts or build_tts_engine(settings, self.runtime)
        self.asr = asr or build_asr_engine(settings, self.runtime)
        self.phoneme = phoneme or build_phoneme_engine(settings, self.runtime)
        self.cache = AudioCache(settings.cache_path, settings.cache_max_mb * 1024 * 1024)
        self.metrics = Metrics()
        self.weights = parse_weights(settings.score_weights)
        # The phoneme pass runs inside an assess call (already holding an ASR slot); its
        # own semaphore bounds concurrent wav2vec2 forwards. On timeout the assessment
        # goes out without phonemes instead of failing.
        self._phoneme_slots = threading.BoundedSemaphore(max(1, self.runtime.max_concurrency))
        # Parallel phonemes (§2.4): the wav2vec2 forward runs here while Whisper transcribes.
        self._phoneme_pool = ThreadPoolExecutor(
            max_workers=max(1, self.runtime.max_concurrency), thread_name_prefix="speech-phoneme"
        )
        self.last_assess_parallel = False  # observability hook for tests and logs
        self._pcm_lru = _PcmLRU(settings.sentence_pcm_lru)
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
            "runtime": self.runtime.as_health(),
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

    def ensure_tts_ready(self) -> None:
        """Raise the 503 ``ServiceError`` the API returns when the TTS engine cannot serve."""
        self._ensure_ready(self.tts)

    def sentence_spans(self, text: str) -> list[tuple[int, int]]:
        return split_sentences(text)

    def sentence_audio_id(self, text: str, span: tuple[int, int], voice: str, speed: float, lang: str) -> str:
        return self.tts_audio_id(text[span[0]:span[1]], voice, speed, lang)

    def cached_sentence(
        self, text: str, span: tuple[int, int], voice: str, speed: float, lang: str, index: int = 0
    ) -> SentenceOutput | None:
        """Sentence output from the disk cache only (never synthesizes)."""
        hit = self.cache.get(self.sentence_audio_id(text, span, voice, speed, lang))
        return None if hit is None else self._sentence_from_cache(hit, index, span, cached=True)

    def synthesize_sentence(
        self, text: str, span: tuple[int, int], voice: str, speed: float, lang: str, index: int = 0
    ) -> SentenceOutput:
        """One sentence of ``text`` (cache hit or blocking synthesis + encode + cache)."""
        start, end = span
        sentence = text[start:end]
        audio_id = self.tts_audio_id(sentence, voice, speed, lang)
        hit = self.cache.get(audio_id)
        if hit is not None:
            return self._sentence_from_cache(hit, index, span, cached=True)
        self._ensure_ready(self.tts)
        try:
            with self.metrics.time_inference(self.tts.name):
                result = self.tts.synthesize(sentence, voice, speed, lang)
        except EngineDisabled as exc:
            raise ServiceError(503, "engine_disabled", str(exc)) from exc
        pcm = np.ascontiguousarray(np.asarray(result.audio_f32, dtype=np.float32).reshape(-1))
        payload = self._encode(pcm, result.sample_rate)
        # Cached words are relative to the sentence text: the same sentence in another
        # block (or at another position) hits the same cache entry.
        words = []
        for w in result.words:
            if sentence[w.char_start:w.char_end] != w.text:
                logger.warning("tts word %r does not round-trip to its offsets; dropped", w.text)
                continue
            words.append(
                {"text": w.text, "start": round(w.start, 3), "end": round(w.end, 3), "char_start": w.char_start, "char_end": w.char_end}
            )
        meta = {
            "audio_id": audio_id,
            "engine": self.tts.name,
            "model": self.tts.model,
            "voice": voice,
            "speed": speed,
            "lang": lang,
            "text": sentence,
            "duration_seconds": audio_tools.duration_seconds(pcm, result.sample_rate),
            "sample_rate": result.sample_rate,
            "words": words,
        }
        hit = self.cache.put(audio_id, payload, self.audio_format, meta)
        self._pcm_lru.put(audio_id, pcm, result.sample_rate)
        return self._sentence_from_cache(hit, index, span, cached=False)

    def synthesize_sentences(self, text: str, voice: str, speed: float, lang: str) -> Iterator[SentenceOutput]:
        """Yield each sentence of ``text`` as soon as it is ready (cache hit or synthesis)."""
        self._ensure_ready(self.tts)
        for index, span in enumerate(split_sentences(text)):
            yield self.synthesize_sentence(text, span, voice, speed, lang, index)

    def synthesize(self, text: str, voice: str, speed: float, lang: str) -> TTSOutput:
        """Blocking block synthesis: sentences (cached or new) -> PCM concat -> one encode -> cache.

        The block ``audio_id`` is the same as before contract 3, so offline clients that
        stored it keep working. Caller checked the block cache already.
        """
        audio_id = self.tts_audio_id(text, voice, speed, lang)
        spans = split_sentences(text)
        if not spans:
            raise ServiceError(400, "text_required", "text is required")
        self._ensure_ready(self.tts)
        parts: list[np.ndarray] = []
        words: list[dict[str, Any]] = []
        sample_rate: int | None = None
        offset_samples = 0
        single: SentenceOutput | None = None
        for index, span in enumerate(spans):
            sentence = self.synthesize_sentence(text, span, voice, speed, lang, index)
            if len(spans) == 1 and sentence.audio_id == audio_id:
                single = sentence  # the block *is* the sentence: nothing to concatenate or re-encode
                break
            pcm, sr = self._sentence_pcm(sentence, voice, speed, lang)
            if sample_rate is None:
                sample_rate = sr
            elif sr != sample_rate:
                raise EngineError(f"sentence sample rate {sr} differs from {sample_rate}")
            offset = offset_samples / sr
            for w in sentence.words:
                words.append({**w, "start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3)})
            parts.append(pcm)
            offset_samples += len(pcm)
        if single is not None:
            hit = self.cache.get(single.audio_id)
            if hit is not None:
                return self._output_from_cache(hit, cached=single.cached)
        assert sample_rate is not None
        pcm = np.concatenate(parts) if len(parts) > 1 else parts[0]
        payload = self._encode(pcm, sample_rate)
        meta = {
            "audio_id": audio_id,
            "engine": self.tts.name,
            "model": self.tts.model,
            "voice": voice,
            "speed": speed,
            "lang": lang,
            "text": text,
            "duration_seconds": audio_tools.duration_seconds(pcm, sample_rate),
            "sample_rate": sample_rate,
            "words": words,
            "sentences": [[a, b] for a, b in spans],
        }
        hit = self.cache.put(audio_id, payload, self.audio_format, meta)
        return self._output_from_cache(hit, cached=False)

    def _encode(self, pcm: np.ndarray, sample_rate: int) -> bytes:
        if self.audio_format == "mp3":
            return audio_tools.encode_mp3(pcm, sample_rate)
        return audio_tools.encode_wav(pcm, sample_rate)

    def _sentence_pcm(self, sentence: SentenceOutput, voice: str, speed: float, lang: str) -> tuple[np.ndarray, int]:
        """PCM of a sentence: the in-memory LRU first, else the cached file decoded and
        fitted to the cached duration (so block offsets equal the sum of sentence durations)."""
        item = self._pcm_lru.get(sentence.audio_id)
        if item is not None:
            return item
        hit = self.cache.get(sentence.audio_id)
        if hit is None:
            # Evicted between synthesis and assembly (tiny cache budget): synthesize again,
            # which refills both the disk cache and the PCM LRU.
            fresh = self.synthesize_sentence(sentence.text, (0, len(sentence.text)), voice, speed, lang, sentence.index)
            item = self._pcm_lru.get(fresh.audio_id)
            if item is not None:
                return item
            hit = self.cache.get(fresh.audio_id)
            if hit is None:
                raise EngineError("sentence audio vanished from the cache before block assembly")
        sr = int(hit.meta.get("sample_rate", 24_000))
        try:
            pcm = audio_tools.decode_file_to_f32(hit.audio_path, sr)
        except (audio_tools.AudioDecodeError, RuntimeError) as exc:
            raise EngineError(f"could not decode cached sentence audio: {exc}") from exc
        pcm = audio_tools.fit_length(pcm, int(round(float(hit.meta.get("duration_seconds", 0.0)) * sr)))
        self._pcm_lru.put(sentence.audio_id, pcm, sr)
        return pcm, sr

    def _sentence_from_cache(self, hit: CachedAudio, index: int, span: tuple[int, int], cached: bool) -> SentenceOutput:
        m = hit.meta
        shift = span[0]
        return SentenceOutput(
            index=index,
            audio_id=hit.audio_id,
            char_start=span[0],
            char_end=span[1],
            text=str(m.get("text", "")),
            duration_seconds=float(m.get("duration_seconds", 0.0)),
            sample_rate=int(m.get("sample_rate", 24_000)),
            cached=cached,
            content_type=hit.content_type,
            words=[
                {**w, "char_start": int(w["char_start"]) + shift, "char_end": int(w["char_end"]) + shift}
                for w in m.get("words", [])
            ],
        )

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
        # Parallel phonemes (§2.4): both models only need the PCM, so the wav2vec2 forward
        # starts now in its own thread; the phonetic alignment still waits for Whisper.
        future: Future[Posteriors | None] | None = None
        if self._parallel_phonemes_possible(pcm):
            future = self._phoneme_pool.submit(self._phoneme_posteriors, pcm, [])
        self.last_assess_parallel = future is not None
        try:
            with self.metrics.time_inference(self.asr.name):
                heard = self.asr.transcribe(pcm, reference_text=reference_text, raw_bytes=audio_bytes)
        except EngineDisabled as exc:
            raise ServiceError(503, "engine_disabled", str(exc)) from exc

        refs = reference_words(reference_text)
        words, extras = align(refs, heard, weak_confidence=self.settings.weak_confidence)
        self._rescue_homophones(words, lang)
        post: Posteriors | None = None
        if future is not None:
            post = future.result()  # already finished or finishing: wait for the forward
        phoneme_active = self._phoneme_pass(pcm, heard, words, post=post, precomputed=future is not None)
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

    def _parallel_phonemes_possible(self, pcm: np.ndarray) -> bool:
        """Parallel only when configured and the recognizer does not depend on the ASR
        words (the fake engine does). Too-short PCM is the engine's own error (-> no phonemes)."""
        if not self.runtime.parallel_phonemes:
            return False
        if getattr(self.phoneme, "needs_heard_words", False):
            return False
        return self._phoneme_ready()

    def _phoneme_posteriors(self, pcm: np.ndarray, heard: list[HeardWord]) -> Posteriors | None:
        """The wav2vec2 forward under its own slot; ``None`` means "assess without phonemes"."""
        if not self._phoneme_ready():
            return None
        if not self._phoneme_slots.acquire(timeout=self.settings.busy_wait_seconds):
            logger.warning("phoneme slots busy; assessment goes out without phonemes")
            return None
        try:
            with self.metrics.time_inference(self.phoneme.name):
                return self.phoneme.posteriors(pcm, heard)
        except Exception as exc:  # noqa: BLE001
            logger.warning("phoneme scoring skipped: %s", exc)
            return None
        finally:
            self._phoneme_slots.release()

    def _phoneme_pass(
        self, pcm: np.ndarray, heard: list[HeardWord], words: list[AlignedWord], *,
        post: Posteriors | None = None, precomputed: bool = False,
    ) -> bool:
        """Fill phonemes/phoneme_score/IPA and apply the ``phoneme`` status override.

        ``post`` may come from the parallel forward (``precomputed=True``); otherwise the
        forward runs here, after the ASR, as in the sequential path.
        """
        if not heard:
            return False
        if not precomputed:
            post = self._phoneme_posteriors(pcm, heard)
        if post is None:
            return False
        try:
            expected = self.phoneme.expected([normalize_word(w.text) for w in words])
        except Exception as exc:  # noqa: BLE001
            logger.warning("phoneme scoring skipped: %s", exc)
            return False
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


__all__ = ["SentenceOutput", "SpeechService", "ServiceError", "TTSOutput", "audio_id_for", "display_tokens", "resolve_runtime_from"]
