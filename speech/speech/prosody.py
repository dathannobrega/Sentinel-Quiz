"""Basic prosody (contract 2 §2.3): pitch range, monotone reading and phrase breaks.

* F0 by normalized autocorrelation in numpy: 40 ms frames every 10 ms, 75-400 Hz,
  only voiced frames (enough energy and a clear periodicity peak).
* ``pitch_range_semitones`` = standard deviation of F0 in semitones (re. the median);
  ``monotone`` when it is below 2.0.
* Breaks per reference word: ``"unexpected"`` when the gap before it exceeds 0.5 s and
  the previous word is not followed by ``, . ; : ! ?``; ``"missing"`` on a word ending
  a sentence (``. ! ?``) when the next one starts less than 0.12 s later.
* ``score = clamp(1 - 0.1*unexpected - 0.05*missing - (0.3 if monotone), 0, 1)``;
  no prosody (``None``) when fewer than 3 words were heard.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

HOP_SECONDS = 0.01
FRAME_SECONDS = 0.04
F0_MIN = 75.0
F0_MAX = 400.0
VOICING_THRESHOLD = 0.5  # normalized autocorrelation peak for a voiced frame
ENERGY_RATIO = 0.05  # frame RMS relative to the loud frames (95th percentile) to count
MIN_VOICED_FRAMES = 10
OCTAVE_OUTLIER_SEMITONES = 9.0  # F0 further than this from the median = octave error
MONOTONE_SEMITONES = 2.0
UNEXPECTED_GAP = 0.5
MISSING_GAP = 0.12
MIN_HEARD_WORDS = 3
PAUSE_PUNCT = set(",.;:!?")
SENTENCE_PUNCT = set(".!?")


def f0_track(pcm: np.ndarray, sample_rate: int) -> np.ndarray:
    """F0 (Hz) of the voiced frames, in time order; empty when nothing is voiced."""
    x = np.asarray(pcm, dtype=np.float64)
    win = int(round(FRAME_SECONDS * sample_rate))
    hop = int(round(HOP_SECONDS * sample_rate))
    if x.size < win or win <= 0 or hop <= 0:
        return np.zeros(0)
    n = 1 + (x.size - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    frames = x[idx]
    frames = frames - frames.mean(axis=1, keepdims=True)
    rms = np.sqrt((frames**2).mean(axis=1))
    loud = np.percentile(rms, 95) if rms.size else 0.0
    if loud <= 1e-5:
        return np.zeros(0)
    keep = rms >= max(ENERGY_RATIO * loud, 1e-4)
    if not keep.any():
        return np.zeros(0)
    frames = frames[keep]
    lag_min = max(2, int(np.floor(sample_rate / F0_MAX)))
    lag_max = min(win - 2, int(np.ceil(sample_rate / F0_MIN)))
    if lag_max <= lag_min + 2:
        return np.zeros(0)
    nfft = 1 << int(np.ceil(np.log2(2 * win)))
    spec = np.fft.rfft(frames, n=nfft, axis=1)
    acf = np.fft.irfft(spec * np.conj(spec), n=nfft, axis=1)[:, :win]
    # Normalize each lag by the energy of the two overlapping segments, so the peak of
    # a periodic signal is ~1 whatever the lag (the biased ACF decays with the lag).
    sq = np.cumsum(frames**2, axis=1)
    total = sq[:, -1:]
    lags = np.arange(lag_min, lag_max + 1)
    head = sq[:, win - lags - 1]  # energy of x[0 : win - lag]
    tail = total - sq[:, lags - 1]  # energy of x[lag : win]
    norm = acf[:, lags] / np.sqrt(np.maximum(head * tail, 1e-12))
    f0 = np.zeros(frames.shape[0])
    for i, row in enumerate(norm):
        peaks = np.flatnonzero((row[1:-1] >= row[:-2]) & (row[1:-1] > row[2:])) + 1
        if peaks.size == 0:
            continue
        best = row[peaks].max()
        if best < VOICING_THRESHOLD:
            continue
        # The first peak close to the best one avoids picking a multiple of the period.
        k = int(peaks[np.argmax(row[peaks] >= 0.9 * best)])
        y0, y1, y2 = row[k - 1], row[k], row[k + 1]
        denom = y0 - 2 * y1 + y2
        shift = 0.5 * (y0 - y2) / denom if denom != 0 else 0.0
        f0[i] = sample_rate / (lags[k] + shift)
    return f0[f0 > 0]


def pitch_range_semitones(f0: np.ndarray) -> float | None:
    """Standard deviation of F0 in semitones; None with too few voiced frames."""
    f0 = np.asarray(f0, dtype=np.float64)
    f0 = f0[(f0 >= F0_MIN * 0.9) & (f0 <= F0_MAX * 1.1)]
    if f0.size < MIN_VOICED_FRAMES:
        return None
    semis = 12.0 * np.log2(f0 / np.median(f0))
    semis = semis[np.abs(semis) <= OCTAVE_OUTLIER_SEMITONES]
    if semis.size < MIN_VOICED_FRAMES:
        return None
    return float(np.std(semis))


@dataclass(slots=True)
class TimedWord:
    """A reference word with its ASR timing (``start``/``end`` None when missed)."""

    index: int
    char_start: int
    char_end: int
    start: float | None
    end: float | None


def _between(text: str, a: int, b: int) -> str:
    return text[a:b] if 0 <= a <= b <= len(text) else ""


def detect_breaks(words: Sequence[TimedWord], text: str) -> dict[int, str]:
    """Word index -> ``"unexpected"`` | ``"missing"`` (contract 2 §2.3)."""
    timed = [w for w in words if w.start is not None and w.end is not None]
    out: dict[int, str] = {}
    for prev, cur in zip(timed, timed[1:]):
        gap = float(cur.start) - float(prev.end)  # type: ignore[arg-type]
        between = _between(text, prev.char_end, cur.char_start)
        if gap > UNEXPECTED_GAP and not (set(between) & PAUSE_PUNCT):
            out[cur.index] = "unexpected"
        if gap < MISSING_GAP and (set(_between(text, prev.char_end, cur.char_start)) & SENTENCE_PUNCT):
            out.setdefault(prev.index, "missing")
    return out


def analyze(
    pcm: np.ndarray, sample_rate: int, words: Sequence[TimedWord], text: str, heard_count: int,
    window: tuple[float | None, float | None] = (None, None),
) -> tuple[dict | None, dict[int, str]]:
    """Return ``(prosody block | None, breaks by word index)``."""
    if heard_count < MIN_HEARD_WORDS:
        return None, {}
    breaks = detect_breaks(words, text)
    unexpected = sum(1 for v in breaks.values() if v == "unexpected")
    missing = sum(1 for v in breaks.values() if v == "missing")
    pitch: float | None = None
    audio = np.asarray(pcm, dtype=np.float32)
    if audio.size and sample_rate:
        first, last = window
        if first is not None and last is not None:
            a = max(0, int((first - 0.1) * sample_rate))
            b = min(audio.size, int((last + 0.1) * sample_rate))
            audio = audio[a:b] if b > a else audio
        pitch = pitch_range_semitones(f0_track(audio, sample_rate))
    monotone = pitch is not None and pitch < MONOTONE_SEMITONES
    score = 1.0 - 0.1 * unexpected - 0.05 * missing - (0.3 if monotone else 0.0)
    block = {
        "score": round(max(0.0, min(1.0, score)), 3),
        "pitch_range_semitones": None if pitch is None else round(pitch, 2),
        "monotone": monotone,
        "unexpected_breaks": unexpected,
        "missing_breaks": missing,
    }
    return block, breaks
