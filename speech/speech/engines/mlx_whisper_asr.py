"""mlx-whisper ASR for Apple Silicon (optional extra ``mlx``).

Same decoding policy as the faster-whisper engine: word timestamps, English, no
context carry-over and no reference-text prompt.
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np

from .base import EngineError, HeardWord, LazyLoader

logger = logging.getLogger("speech.asr.mlx_whisper")


class MlxWhisperASR(LazyLoader):
    name = "mlx-whisper"
    needs_decoded_audio = True

    def __init__(self, model: str) -> None:
        self.model = model
        self._module: Any = None
        self._init_loader()

    def _do_load(self) -> None:
        import mlx_whisper  # optional dependency, imported lazily

        self._module = mlx_whisper
        # Transcribing one second of silence downloads the weights and warms the graph.
        mlx_whisper.transcribe(np.zeros(16_000, dtype=np.float32), path_or_hf_repo=self.model, language="en", word_timestamps=True, condition_on_previous_text=False)

    def transcribe(
        self, audio_f32_16k: np.ndarray, *, reference_text: str | None = None, raw_bytes: bytes | None = None
    ) -> list[HeardWord]:
        if self._module is None:
            self.load()
        try:
            result = self._module.transcribe(
                np.asarray(audio_f32_16k, dtype=np.float32),
                path_or_hf_repo=self.model,
                word_timestamps=True,
                language="en",
                condition_on_previous_text=False,
                temperature=0.0,
            )
        except Exception as exc:  # noqa: BLE001
            raise EngineError(f"mlx-whisper transcription failed: {exc}") from exc
        words: list[HeardWord] = []
        for segment in result.get("segments", []):
            for w in segment.get("words", []) or []:
                text = str(w.get("word", "")).strip()
                if not text:
                    continue
                words.append(
                    HeardWord(
                        text=text,
                        start=float(w.get("start", 0.0)),
                        end=float(w.get("end", 0.0)),
                        probability=float(w.get("probability", 1.0)),
                    )
                )
        return words
