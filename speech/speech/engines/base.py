"""Engine contracts. Concrete engines live next to this module; the service only
relies on these protocols so tests can swap in the fake engines."""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

import numpy as np


@dataclass(slots=True)
class TTSWord:
    text: str
    start: float
    end: float
    char_start: int
    char_end: int


@dataclass(slots=True)
class TTSResult:
    audio_f32: np.ndarray  # mono float32
    sample_rate: int
    words: list[TTSWord] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return float(len(self.audio_f32)) / float(self.sample_rate) if self.sample_rate else 0.0


@dataclass(slots=True)
class HeardWord:
    text: str
    start: float
    end: float
    probability: float
    # Test hook only: the fake phoneme engine "hears" these letters instead of ``text``
    # (lets tests model "Whisper wrote the right word but the sounds were wrong").
    phones: str | None = None


@dataclass
class Posteriors:
    """Frame-level CTC log-posteriors of a phoneme recognizer over a whole recording."""

    logp: np.ndarray  # [frames, vocab] log-softmax
    frame_rate: float  # frames per second (50 for wav2vec2)
    vocab: list[str]  # id -> token
    blank_id: int
    special_ids: frozenset[int] = frozenset()  # never "heard" (<s>, </s>, <unk>)

    def __post_init__(self) -> None:
        self._index = {tok: i for i, tok in enumerate(self.vocab)}

    def token_id(self, token: str) -> int | None:
        return self._index.get(token)


class EngineError(RuntimeError):
    """Raised by an engine when inference itself fails (mapped to 500 by the API)."""


class EngineDisabled(RuntimeError):
    """Raised by the ``none`` engines (mapped to 503 engine_disabled)."""


@runtime_checkable
class TTSEngine(Protocol):
    name: str
    model: str

    @property
    def ready(self) -> bool: ...

    def load(self) -> None: ...

    def synthesize(self, text: str, voice: str, speed: float, lang: str) -> TTSResult: ...


@runtime_checkable
class ASREngine(Protocol):
    name: str
    model: str
    # False only for the fake engine, which reads the "transcript" from the upload bytes.
    needs_decoded_audio: bool

    @property
    def ready(self) -> bool: ...

    def load(self) -> None: ...

    def transcribe(
        self, audio_f32_16k: np.ndarray, *, reference_text: str | None = None, raw_bytes: bytes | None = None
    ) -> list[HeardWord]: ...


@dataclass(slots=True)
class ExpectedPhonemes:
    """Expected pronunciation of one reference word, already in the model's tokens."""

    ipa: str  # display IPA (stress marks kept, tie characters removed)
    tokens: list[str]


@runtime_checkable
class PhonemeEngine(Protocol):
    name: str
    model: str
    # True when ``posteriors`` needs the ASR words (only the fake engine): then the forward
    # cannot overlap the ASR and the service keeps the sequential path.
    needs_heard_words: bool

    @property
    def ready(self) -> bool: ...

    def load(self) -> None: ...

    def posteriors(self, audio_f32_16k: np.ndarray, heard: list[HeardWord]) -> Posteriors: ...

    def expected(self, words: list[str]) -> list[list[ExpectedPhonemes]]:
        """Pronunciation variants per normalized reference word (empty list = unknown)."""
        ...


class LazyLoader:
    """Mixin: thread-safe one-shot ``load()`` with ``ready``/``loading``/``error`` state.

    Why: the preload thread and the first request may race; whoever arrives second
    must wait for the same load instead of loading the model twice (RAM!).
    """

    _lock: threading.Lock
    _loaded: bool
    _loading: bool
    _error: str | None

    def _init_loader(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._loading = False
        self._error = None

    @property
    def ready(self) -> bool:
        return self._loaded

    @property
    def loading(self) -> bool:
        return self._loading

    @property
    def error(self) -> str | None:
        return self._error

    def load(self) -> None:
        with self._lock:
            if self._loaded:
                return
            self._loading = True
            try:
                self._do_load()
                self._loaded = True
                self._error = None
            except Exception as exc:  # noqa: BLE001 - surface any loader failure in /healthz
                self._error = f"{type(exc).__name__}: {exc}"
                raise
            finally:
                self._loading = False

    def _do_load(self) -> None:  # pragma: no cover - overridden
        raise NotImplementedError


class DisabledTTS:
    """``SPEECH_TTS_ENGINE=none``: advertised as disabled, every call is a 503."""

    name = "none"

    def __init__(self, model: str = "") -> None:
        self.model = model

    @property
    def ready(self) -> bool:
        return False

    @property
    def loading(self) -> bool:
        return False

    @property
    def error(self) -> str | None:
        return None

    def load(self) -> None:
        return None

    def synthesize(self, text: str, voice: str, speed: float, lang: str) -> TTSResult:
        raise EngineDisabled("TTS engine is disabled")


class DisabledASR:
    name = "none"
    needs_decoded_audio = False

    def __init__(self, model: str = "") -> None:
        self.model = model

    @property
    def ready(self) -> bool:
        return False

    @property
    def loading(self) -> bool:
        return False

    @property
    def error(self) -> str | None:
        return None

    def load(self) -> None:
        return None

    def transcribe(self, audio_f32_16k: np.ndarray, *, reference_text: str | None = None, raw_bytes: bytes | None = None) -> list[HeardWord]:
        raise EngineDisabled("ASR engine is disabled")


class DisabledPhoneme:
    """``SPEECH_PHONEME_ENGINE=none``: assessments carry no phoneme scores."""

    name = "none"
    needs_heard_words = False

    def __init__(self, model: str = "") -> None:
        self.model = model

    @property
    def ready(self) -> bool:
        return False

    @property
    def loading(self) -> bool:
        return False

    @property
    def error(self) -> str | None:
        return None

    def load(self) -> None:
        return None

    def posteriors(self, audio_f32_16k: np.ndarray, heard: list[HeardWord]) -> Posteriors:
        raise EngineDisabled("phoneme engine is disabled")

    def expected(self, words: list[str]) -> list[list[ExpectedPhonemes]]:
        return [[] for _ in words]
