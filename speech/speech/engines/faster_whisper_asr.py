"""faster-whisper (CTranslate2) ASR with word timestamps.

Deliberately *no* ``initial_prompt`` with the reference text: priming the decoder
with the expected words makes Whisper "autocorrect" mispronunciations, which is
exactly the signal the assessment needs.
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np

from .base import EngineError, HeardWord, LazyLoader

logger = logging.getLogger("speech.asr.faster_whisper")


class FasterWhisperASR(LazyLoader):
    name = "faster-whisper"
    needs_decoded_audio = True

    def __init__(self, model: str, compute_type: str = "int8", cpu_threads: int = 4) -> None:
        self.model = model
        self.compute_type = compute_type
        self.cpu_threads = cpu_threads
        self._model: Any = None
        self._init_loader()

    def _do_load(self) -> None:
        from faster_whisper import WhisperModel  # heavy import, keep lazy

        self._model = WhisperModel(self.model, device="cpu", compute_type=self.compute_type, cpu_threads=self.cpu_threads)

    def transcribe(
        self, audio_f32_16k: np.ndarray, *, reference_text: str | None = None, raw_bytes: bytes | None = None
    ) -> list[HeardWord]:
        if self._model is None:
            self.load()
        try:
            segments, _info = self._model.transcribe(
                np.asarray(audio_f32_16k, dtype=np.float32),
                language="en",
                beam_size=5,
                temperature=0.0,
                word_timestamps=True,
                condition_on_previous_text=False,
                vad_filter=True,
            )
            words: list[HeardWord] = []
            for segment in segments:
                for w in segment.words or []:
                    text = (w.word or "").strip()
                    if not text:
                        continue
                    words.append(HeardWord(text=text, start=float(w.start), end=float(w.end), probability=float(w.probability)))
        except Exception as exc:  # noqa: BLE001
            raise EngineError(f"faster-whisper transcription failed: {exc}") from exc
        return words
