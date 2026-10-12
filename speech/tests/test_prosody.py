from __future__ import annotations

import numpy as np
import pytest

from speech.prosody import TimedWord, analyze, detect_breaks, f0_track, pitch_range_semitones
from speech.textnorm import display_tokens

SR = 16_000


def tone(freq_start: float, freq_end: float, seconds: float = 3.0) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    freq = np.exp(np.linspace(np.log(freq_start), np.log(freq_end), t.size))
    return (0.3 * np.sin(2 * np.pi * np.cumsum(freq) / SR)).astype(np.float32)


def test_f0_of_a_flat_tone() -> None:
    f0 = f0_track(tone(150, 150), SR)
    assert f0.size > 200
    assert np.median(f0) == pytest.approx(150, rel=0.01)


def test_sweep_is_not_monotone_and_flat_tone_is() -> None:
    sweep = pitch_range_semitones(f0_track(tone(100, 250), SR))
    flat = pitch_range_semitones(f0_track(tone(150, 150), SR))
    assert sweep is not None and sweep > 4.0  # 15.9 semitone glide -> std ~4.6
    assert flat is not None and flat < 0.1
    words = [TimedWord(i, 0, 0, i * 0.5, i * 0.5 + 0.4) for i in range(5)]
    flat_block, _ = analyze(tone(150, 150), SR, words, "", heard_count=5)
    sweep_block, _ = analyze(tone(100, 250), SR, words, "", heard_count=5)
    assert flat_block["monotone"] is True and flat_block["score"] == pytest.approx(0.7)
    assert sweep_block["monotone"] is False and sweep_block["score"] == pytest.approx(1.0)


def test_silence_has_no_pitch() -> None:
    assert f0_track(np.zeros(SR, dtype=np.float32), SR).size == 0
    assert pitch_range_semitones(np.array([120.0, 130.0])) is None


def _timed(text: str, spans: list[tuple[float, float] | None]) -> list[TimedWord]:
    tokens = display_tokens(text)
    assert len(tokens) == len(spans)
    return [
        TimedWord(i, tok.char_start, tok.char_end, None if s is None else s[0], None if s is None else s[1])
        for i, (tok, s) in enumerate(zip(tokens, spans))
    ]


def test_breaks_from_word_timings_and_punctuation() -> None:
    text = "Attackers send emails, then wait. Users click links"
    words = _timed(text, [
        (0.0, 0.5), (0.6, 0.8),
        (0.9, 1.3),   # "emails," followed by a 0.7 s pause: allowed after a comma
        (2.0, 2.2),
        (2.3, 2.6),   # "wait." and "Users" 0.05 s later: missing break
        (2.65, 3.0),
        (3.1, 3.4),
        (4.1, 4.4),   # 0.7 s pause mid-sentence: unexpected
    ])
    breaks = detect_breaks(words, text)
    assert breaks == {4: "missing", 7: "unexpected"}
    block, by_word = analyze(np.zeros(0, dtype=np.float32), SR, words, text, heard_count=8)
    assert by_word == breaks
    assert block == {
        "score": pytest.approx(0.85), "pitch_range_semitones": None, "monotone": False,
        "unexpected_breaks": 1, "missing_breaks": 1,
    }


def test_missed_words_are_skipped_and_short_recordings_have_no_prosody() -> None:
    text = "One two three four"
    words = _timed(text, [(0.0, 0.3), None, (1.0, 1.3), (1.4, 1.6)])
    # the gap 0.3 -> 1.0 is measured between heard neighbours, without punctuation
    assert detect_breaks(words, text) == {2: "unexpected"}
    assert analyze(np.zeros(0), SR, words, text, heard_count=2) == (None, {})
