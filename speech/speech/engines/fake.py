"""Deterministic engines for tests and for running the API without models.

FakeTTS emits 0.25 s of near-silent sine per word with evenly spaced timings.
FakeASR has no acoustic model: when the uploaded bytes decode as UTF-8 text starting
with ``FAKE:`` the remainder is the transcript (tokens may carry ``@prob``, e.g.
``FAKE:security awareness@0.3 training``, and ``#letters`` for what the fake phoneme
engine hears, e.g. ``security#zzzzzzzz``); otherwise it "hears" the reference text
perfectly with 0.05 s between words.

FakePhoneme treats letters as phonemes: the expected "phonemes" of a word are its
letters and the posteriors spell out, inside each heard word's time span, the
letters of what was heard (``HeardWord.phones`` or the text).
"""
from __future__ import annotations

import re

import numpy as np

from ..phonemes import log_softmax
from ..textnorm import display_tokens
from .base import ExpectedPhonemes, HeardWord, Posteriors, TTSResult, TTSWord

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
        for token, prob in tokens:
            word, _, phones = token.partition("#")
            if not word:
                continue
            # "..." in the transcript is a 1.2 s silence (tests for long pauses).
            if set(word) == {"."}:
                cursor += 1.2
                continue
            words.append(
                HeardWord(text=word, start=round(cursor, 3), end=round(cursor + 0.3, 3), probability=prob, phones=phones or None)
            )
            cursor += 0.35
        return words


_LETTERS = "abcdefghijklmnopqrstuvwxyz"
FAKE_VOCAB = ["<pad>", "<s>", "</s>", "<unk>", *_LETTERS]
FAKE_FRAME_RATE = 50.0


class FakePhoneme:
    """Letters-as-phonemes recognizer driven by the heard words (no audio needed)."""

    name = "fake"
    # The posteriors are built from the ASR words, so this engine cannot run in parallel
    # with the ASR (contract 3 §2.4); the service falls back to the sequential path.
    needs_heard_words = True

    def __init__(self, model: str = "fake") -> None:
        self.model = model
        self._ready = False
        self._index = {tok: i for i, tok in enumerate(FAKE_VOCAB)}

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

    def expected(self, words: list[str]) -> list[list[ExpectedPhonemes]]:
        out = []
        for word in words:
            letters = re.sub(r"[^a-z]", "", (word or "").lower())
            out.append([ExpectedPhonemes(ipa=letters, tokens=list(letters))] if letters else [])
        return out

    def posteriors(self, audio_f32_16k: np.ndarray, heard: list[HeardWord]) -> Posteriors:
        end = max((w.end for w in heard), default=0.0)
        frames = max(int(np.ceil((end + 0.5) * FAKE_FRAME_RATE)), 1)
        logits = np.zeros((frames, len(FAKE_VOCAB)), dtype=np.float32)
        logits[:, 0] = 8.0  # blank dominates silence
        for word in heard:
            letters = re.sub(r"[^a-z]", "", (word.phones or word.text).lower())
            if not letters:
                continue
            a = int(round(word.start * FAKE_FRAME_RATE))
            b = max(a + 1, int(round(word.end * FAKE_FRAME_RATE)))
            positions = np.linspace(a, b - 1, num=len(letters))
            for letter, pos in zip(letters, positions):
                logits[min(int(round(pos)), frames - 1), self._index[letter]] = 16.0
        return Posteriors(
            logp=log_softmax(logits), frame_rate=FAKE_FRAME_RATE, vocab=list(FAKE_VOCAB), blank_id=0,
            special_ids=frozenset({1, 2, 3}),
        )
