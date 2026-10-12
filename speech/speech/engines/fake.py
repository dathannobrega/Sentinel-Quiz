"""Deterministic engines for tests and for running the API without models.

FakeTTS emits 0.25 s of near-silent sine per word with evenly spaced timings.
FakeASR has no acoustic model: when the uploaded bytes decode as UTF-8 text starting
with ``FAKE:`` the remainder is the transcript (tokens may carry ``@prob``, e.g.
``FAKE:security awareness@0.3 training``); otherwise it "hears" the reference text
perfectly with 0.05 s between words.
"""
from __future__ import annotations

import numpy as np

from ..textnorm import display_tokens
from .base import HeardWord, TTSResult, TTSWord

SAMPLE_RATE = 24_000
SECONDS_PER_WORD = 0.25
FAKE_PREFIX = "FAKE:"


class FakeTTS:
    name = "fake"

    def __init__(self, model: str = "fake") -> None:
        self.model = model
        self._ready = False

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def loading(self) -> bool:
        return False

    @property
    def error(self) -> str | None:
        return None

    def load(self) -> None:
        self._ready = True

    def synthesize(self, text: str, voice: str, speed: float, lang: str) -> TTSResult:
        tokens = display_tokens(text)
        per_word = SECONDS_PER_WORD / max(speed, 0.1)
        n = max(len(tokens), 1)
        total = int(round(n * per_word * SAMPLE_RATE))
        t = np.arange(total, dtype=np.float32) / SAMPLE_RATE
        audio = (0.01 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        duration = total / SAMPLE_RATE
        words = []
        for i, tok in enumerate(tokens):
            start = round(i * per_word, 3)
            end = round(duration if i == len(tokens) - 1 else (i + 1) * per_word - 0.02, 3)
            words.append(TTSWord(tok.text, start, end, tok.char_start, tok.char_end))
        return TTSResult(audio_f32=audio, sample_rate=SAMPLE_RATE, words=words)


class FakeASR:
    name = "fake"
    needs_decoded_audio = False

    def __init__(self, model: str = "fake") -> None:
        self.model = model
        self._ready = False

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def loading(self) -> bool:
        return False

    @property
    def error(self) -> str | None:
        return None

    def load(self) -> None:
        self._ready = True

    def transcribe(
        self, audio_f32_16k: np.ndarray, *, reference_text: str | None = None, raw_bytes: bytes | None = None
    ) -> list[HeardWord]:
        transcript: str | None = None
        if raw_bytes:
            try:
                decoded = raw_bytes.decode("utf-8")
            except UnicodeDecodeError:
                decoded = ""
            if decoded.startswith(FAKE_PREFIX):
                transcript = decoded[len(FAKE_PREFIX):].strip()
        if transcript is None:
            transcript = " ".join(tok.text for tok in display_tokens(reference_text or ""))
            tokens = [(t, 0.95) for t in transcript.split()]
        else:
            tokens = []
            for raw in transcript.split():
                word, _, prob = raw.partition("@")
                tokens.append((word, float(prob) if prob else 0.95))
        words: list[HeardWord] = []
        cursor = 0.0
        for word, prob in tokens:
            if not word:
                continue
            words.append(HeardWord(text=word, start=round(cursor, 3), end=round(cursor + 0.3, 3), probability=prob))
            cursor += 0.35
        return words
