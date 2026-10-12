"""Kokoro-82M text-to-speech with per-word timestamps.

Kokoro's ``KPipeline`` yields one result per text chunk with ``tokens`` (misaki
``MToken``: ``text``, ``start_ts``, ``end_ts``). Timestamps are relative to the chunk,
so chunk audios are concatenated and timestamps shifted by the running duration.
Tokens are mapped back to character offsets in the *original* text with a sequential
search, because misaki keeps the surface text of each token.
"""
from __future__ import annotations

import logging
import re
import threading
from typing import Any

import numpy as np

from ..textnorm import display_tokens
from .base import EngineError, LazyLoader, TTSResult, TTSWord

logger = logging.getLogger("speech.tts.kokoro")

SAMPLE_RATE = 24_000
_ALNUM_RE = re.compile(r"[^\W_]")
_LANG_CODES = {"en-us": "a", "en-gb": "b"}


class KokoroTTS(LazyLoader):
    name = "kokoro"

    def __init__(self, model: str, default_voice: str, torch_threads: int = 0) -> None:
        self.model = model
        self.default_voice = default_voice
        self.torch_threads = torch_threads
        self._pipelines: dict[str, Any] = {}
        self._pipeline_lock = threading.Lock()
        self._init_loader()

    def _do_load(self) -> None:
        if self.torch_threads > 0:
            import torch

            # Big servers (e.g. 16-core Xeons) get faster synthesis with more threads; the
            # default keeps a laptop responsive.
            torch.set_num_threads(self.torch_threads)
        pipeline = self._pipeline("a")
        # Loading the default voice up front makes the first request fast and surfaces
        # a missing voice file during startup instead of under a user's click.
        pipeline.load_voice(self.default_voice)

    def _pipeline(self, lang_code: str) -> Any:
        with self._pipeline_lock:
            pipe = self._pipelines.get(lang_code)
            if pipe is None:
                from kokoro import KPipeline  # heavy import (torch), keep lazy

                shared_model = next(iter(self._pipelines.values())).model if self._pipelines else True
                pipe = KPipeline(lang_code=lang_code, repo_id=self.model, model=shared_model)
                self._pipelines[lang_code] = pipe
            return pipe

    def synthesize(self, text: str, voice: str, speed: float, lang: str) -> TTSResult:
        pipeline = self._pipeline(_LANG_CODES.get(lang.lower(), "a"))
        chunks: list[np.ndarray] = []
        raw_tokens: list[tuple[str, float | None, float | None]] = []
        offset = 0.0
        try:
            for result in pipeline(text, voice=voice, speed=speed, split_pattern=r"\n+"):
                audio = result.audio
                if audio is None:
                    continue
                arr = audio.detach().cpu().numpy().astype(np.float32) if hasattr(audio, "detach") else np.asarray(audio, dtype=np.float32)
                arr = arr.reshape(-1)
                for tok in result.tokens or []:
                    tok_text = getattr(tok, "text", "") or ""
                    if not _ALNUM_RE.search(tok_text):
                        continue
                    start_ts = getattr(tok, "start_ts", None)
                    end_ts = getattr(tok, "end_ts", None)
                    raw_tokens.append(
                        (
                            tok_text,
                            None if start_ts is None else float(start_ts) + offset,
                            None if end_ts is None else float(end_ts) + offset,
                        )
                    )
                chunks.append(arr)
                offset += len(arr) / SAMPLE_RATE
        except Exception as exc:  # noqa: BLE001
            raise EngineError(f"kokoro synthesis failed: {exc}") from exc
        if not chunks:
            raise EngineError("kokoro produced no audio")
        audio_f32 = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
        duration = len(audio_f32) / SAMPLE_RATE
        words = _build_words(text, raw_tokens, duration)
        return TTSResult(audio_f32=audio_f32, sample_rate=SAMPLE_RATE, words=words)


def _map_offsets(text: str, token_texts: list[str]) -> list[tuple[int, int] | None]:
    """Sequential search of each token in the original text (tokens come in order)."""
    offsets: list[tuple[int, int] | None] = []
    cursor = 0
    lowered = text.lower()
    for tok in token_texts:
        candidate = tok.strip()
        found = -1
        if candidate:
            found = text.find(candidate, cursor)
            if found < 0:
                found = lowered.find(candidate.lower(), cursor)
        if found < 0:
            offsets.append(None)
            continue
        offsets.append((found, found + len(candidate)))
        cursor = found + len(candidate)
    return offsets


def _interpolate(starts: list[float | None], ends: list[float | None], duration: float) -> tuple[list[float], list[float]]:
    """Fill missing timestamps linearly between the nearest timed neighbours."""
    n = len(starts)
    s = list(starts)
    e = list(ends)
    for i in range(n):
        if s[i] is None and e[i] is not None:
            s[i] = e[i] - 0.05 if i == 0 else None
        if e[i] is None and s[i] is not None and i == n - 1:
            e[i] = duration
    # Anchor points: known (start, end) pairs; walk runs of unknown words between them.
    i = 0
    while i < n:
        if s[i] is not None and e[i] is not None:
            i += 1
            continue
        j = i
        while j < n and (s[j] is None or e[j] is None):
            j += 1
        left = e[i - 1] if i > 0 and e[i - 1] is not None else 0.0
        right = s[j] if j < n and s[j] is not None else duration
        if right <= left:
            right = min(duration, left + 0.1 * (j - i))
        step = (right - left) / (j - i)
        for k in range(i, j):
            s[k] = left + step * (k - i)
            e[k] = left + step * (k - i + 1)
        i = j
    return [float(x) for x in s], [float(x) for x in e]  # type: ignore[arg-type]


def _build_words(text: str, raw_tokens: list[tuple[str, float | None, float | None]], duration: float) -> list[TTSWord]:
    token_texts = [t[0] for t in raw_tokens]
    offsets = _map_offsets(text, token_texts)
    if any(o is None for o in offsets):
        display = display_tokens(text)
        if len(display) == len(raw_tokens):
            offsets = [(d.char_start, d.char_end) for d in display]
        else:
            logger.warning("kokoro: %d tokens could not be mapped to text offsets; dropping them", sum(o is None for o in offsets))
    kept = [(tok, off) for tok, off in zip(raw_tokens, offsets) if off is not None]
    if not kept:
        return []
    starts, ends = _interpolate([t[1] for t, _ in kept], [t[2] for t, _ in kept], duration)
    words: list[TTSWord] = []
    prev_end = 0.0
    for idx, ((tok_text, _s, _e), (cs, ce)) in enumerate(kept):
        start = max(0.0, min(starts[idx], duration))
        end = min(ends[idx], duration)
        if idx == len(kept) - 1:
            end = duration
        if start < prev_end:
            start = prev_end
        if end <= start:
            end = min(duration, start + 0.05) if start < duration else duration
            start = min(start, end - 0.001) if end > 0 else 0.0
        prev_end = end
        words.append(TTSWord(text=text[cs:ce], start=round(start, 3), end=round(end, 3), char_start=cs, char_end=ce))
    return words
