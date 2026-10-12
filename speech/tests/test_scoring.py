from __future__ import annotations

from dataclasses import asdict

import pytest

from speech.alignment import AlignedWord, Extra
from speech.engines.base import HeardWord
from speech.scoring import compute, count_long_pauses, phoneme_tips, wpm_penalty


def aligned(status: str, index: int, text: str = "w", **kw) -> AlignedWord:
    base = dict(index=index, text=text, char_start=0, char_end=1, status=status, heard=None, confidence=None, start=None, end=None)
    base.update(kw)
    return AlignedWord(**base)


def heard_evenly(n: int, wpm: float) -> list[HeardWord]:
    """n words spread so that (n words) / (last.end - first.start) == wpm."""
    seconds = n / wpm * 60.0
    step = seconds / n
    out = []
    for i in range(n):
        start = i * step
        out.append(HeardWord(text="w", start=start, end=start + step if i < n - 1 else seconds, probability=0.9))
    return out


def test_scores_formulas() -> None:
    # 10 reference words: 6 ok, 2 weak, 1 mispronounced, 1 missed; 1 extra; wpm in range; no pauses.
    words = [aligned("ok", i) for i in range(6)] + [aligned("weak", 6), aligned("weak", 7), aligned("mispronounced", 8), aligned("missed", 9)]
    extras = [Extra(text="um", after_index=2, start=1.0, end=1.2)]
    hyp = heard_evenly(9, wpm=140.0)  # 9 attempted words at 140 wpm
    scores, metrics = compute(words, extras, hyp)
    assert scores.accuracy == pytest.approx((6 + 0.5 * 2) / 10)
    assert scores.completeness == pytest.approx(9 / 10)
    assert scores.fluency == pytest.approx(1 - 0.05)  # only the extra penalizes
    assert scores.overall == pytest.approx(0.6 * 0.7 + 0.2 * 0.9 + 0.2 * 0.95)
    assert metrics["reference_words"] == 10 and metrics["ok"] == 6 and metrics["weak"] == 2
    assert metrics["mispronounced"] == 1 and metrics["missed"] == 1 and metrics["extra"] == 1
    assert metrics["wpm"] == pytest.approx(140.0, abs=0.1)
    assert metrics["long_pauses"] == 0
    assert metrics["target_wpm"] == [120, 170]
    assert scores.as_dict() == {k: round(v, 3) for k, v in asdict(scores).items()}


def test_wpm_penalty_shape() -> None:
    assert wpm_penalty(None) == 0.0
    assert wpm_penalty(120) == 0.0 and wpm_penalty(170) == 0.0 and wpm_penalty(145) == 0.0
    assert wpm_penalty(90) == pytest.approx(0.5)
    assert wpm_penalty(60) == 1.0
    assert wpm_penalty(10) == 1.0
    assert wpm_penalty(200) == pytest.approx(0.5)
    assert wpm_penalty(260) == 1.0


def test_slow_reading_penalizes_fluency() -> None:
    words = [aligned("ok", i) for i in range(10)]
    hyp = heard_evenly(10, wpm=60.0)  # a full penalty
    scores, metrics = compute(words, [], hyp)
    assert metrics["wpm"] == pytest.approx(60.0, abs=0.1)
    assert scores.fluency == pytest.approx(0.5)
    assert scores.accuracy == 1.0 and scores.completeness == 1.0
    assert scores.overall == pytest.approx(0.6 + 0.2 + 0.1)


def test_long_pauses_counted_and_penalized() -> None:
    hyp = [
        HeardWord("a", 0.0, 0.3, 0.9),
        HeardWord("b", 0.4, 0.7, 0.9),  # gap 0.1
        HeardWord("c", 1.6, 1.9, 0.9),  # gap 0.9 -> long pause
        HeardWord("d", 2.0, 2.3, 0.9),  # gap 0.1
        HeardWord("e", 3.5, 3.8, 0.9),  # gap 1.2 -> long pause
    ]
    assert count_long_pauses(hyp) == 2
    words = [aligned("ok", i) for i in range(5)]
    scores, metrics = compute(words, [], hyp)
    assert metrics["long_pauses"] == 2
    # 5 words in 3.8 s = 78.9 wpm -> penalty (120-78.9)/60 = 0.684
    wpm = 5 / 3.8 * 60
    expected = 1 - 0.5 * ((120 - wpm) / 60) - 0.2
    assert scores.fluency == pytest.approx(expected, abs=1e-6)


def test_fluency_clamped_to_zero() -> None:
    words = [aligned("ok", 0)]
    hyp = [HeardWord("a", 0.0, 0.3, 0.9)] + [HeardWord("x", 2.0 * i, 2.0 * i + 0.3, 0.9) for i in range(1, 12)]
    extras = [Extra("x", 0, 0.0, 0.1) for _ in range(11)]
    scores, _ = compute(words, extras, hyp)
    assert scores.fluency == 0.0


def test_nothing_heard_gives_zero_scores() -> None:
    words = [aligned("missed", i) for i in range(3)]
    scores, metrics = compute(words, [], [])
    assert scores.as_dict() == {"accuracy": 0.0, "completeness": 0.0, "fluency": 0.0, "overall": 0.0}
    assert metrics["wpm"] is None and metrics["missed"] == 3


def test_phoneme_tips_aggregate_confusions() -> None:
    words = [
        aligned("mispronounced", 0, "think", heard="tink", expected_ipa="θˈɪŋk", heard_ipa="tˈɪŋk"),
        aligned("mispronounced", 1, "threat", heard="tret", expected_ipa="θɹˈɛt", heard_ipa="tɹˈɛt"),
        aligned("mispronounced", 2, "very", heard="wery", expected_ipa="vˈɛɹi", heard_ipa="wˈɛɹi"),
        aligned("ok", 3, "fine"),
        aligned("mispronounced", 4, "no-ipa", heard="x", expected_ipa=None, heard_ipa=None),
    ]
    tips = phoneme_tips(words)
    assert tips[0] == {"code": "phoneme_confusion", "expected": "θ", "heard": "t", "examples": ["think", "threat"]}
    assert tips[1] == {"code": "phoneme_confusion", "expected": "v", "heard": "w", "examples": ["very"]}
    assert len(tips) <= 3
