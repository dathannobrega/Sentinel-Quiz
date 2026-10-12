from __future__ import annotations

from dataclasses import asdict

import pytest

from speech.alignment import AlignedWord, Extra, align, is_ending_variant, reference_words
from speech.engines.base import HeardWord
from speech.scoring import (
    DEFAULT_WEIGHTS, compute, count_long_pauses, overall_score, parse_weights, phoneme_tips,
    phoneme_tips_from_scores, word_accuracy, wpm_penalty,
)


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
    # 10 reference words: 6 ok, 2 weak, 1 mispronounced (substitution), 1 missed; 1 extra; wpm in range; no pauses.
    words = [aligned("ok", i) for i in range(6)] + [
        aligned("weak", 6), aligned("weak", 7), aligned("mispronounced", 8, reason="substitution"), aligned("missed", 9),
    ]
    extras = [Extra(text="um", after_index=2, start=1.0, end=1.2)]
    hyp = heard_evenly(9, wpm=140.0)  # 9 attempted words at 140 wpm
    scores, metrics = compute(words, extras, hyp)
    assert scores.accuracy == pytest.approx((6 + 0.5 * 2 + 0.25) / 10)
    assert scores.completeness == pytest.approx(9 / 10)
    assert scores.fluency == pytest.approx(1 - 0.05)  # only the extra penalizes
    assert scores.prosody is None
    # no prosody: its 0.15 is redistributed proportionally over 0.5/0.2/0.15
    assert scores.overall == pytest.approx((0.5 * 0.725 + 0.2 * 0.9 + 0.15 * 0.95) / 0.85)
    assert metrics["reference_words"] == 10 and metrics["ok"] == 6 and metrics["weak"] == 2
    assert metrics["mispronounced"] == 1 and metrics["missed"] == 1 and metrics["extra"] == 1
    assert metrics["wpm"] == pytest.approx(140.0, abs=0.1)
    assert metrics["long_pauses"] == 0
    assert metrics["target_wpm"] == [120, 170]
    assert scores.as_dict() == {k: (None if v is None else round(v, 3)) for k, v in asdict(scores).items()}
    assert list(scores.as_dict()) == ["accuracy", "completeness", "fluency", "prosody", "overall"]

    with_prosody, _ = compute(words, extras, hyp, prosody=0.6)
    assert with_prosody.prosody == 0.6
    assert with_prosody.overall == pytest.approx(0.5 * 0.725 + 0.2 * 0.9 + 0.15 * 0.95 + 0.15 * 0.6)


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
    assert scores.overall == pytest.approx((0.5 + 0.2 + 0.15 * 0.5) / 0.85)


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
    assert scores.as_dict() == {"accuracy": 0.0, "completeness": 0.0, "fluency": 0.0, "prosody": None, "overall": 0.0}
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


def test_word_accuracy_rules() -> None:
    assert word_accuracy(aligned("missed", 0), True) == 0.0
    assert word_accuracy(aligned("mispronounced", 0, reason="substitution", phoneme_score=0.9), True) == 0.25
    assert word_accuracy(aligned("mispronounced", 0, reason="substitution"), False) == 0.25
    assert word_accuracy(aligned("mispronounced", 0, reason="phoneme", phoneme_score=0.4), True) == 0.4
    assert word_accuracy(aligned("ok", 0, phoneme_score=0.92), True) == 0.92
    assert word_accuracy(aligned("weak", 0, phoneme_score=0.7), True) == 0.7
    # without the engine (or without a phoneme score) the Inc. 1 weights apply
    assert word_accuracy(aligned("ok", 0, phoneme_score=0.92), False) == 1.0
    assert word_accuracy(aligned("weak", 0), True) == 0.5
    assert word_accuracy(aligned("mispronounced", 0, reason="phoneme"), False) == 0.0


def test_accuracy_uses_phoneme_scores_when_active() -> None:
    words = [aligned("ok", 0, phoneme_score=0.9), aligned("ok", 1, phoneme_score=0.8), aligned("missed", 2)]
    hyp = heard_evenly(2, wpm=140.0)
    on, _ = compute(words, [], hyp, phoneme_active=True)
    off, _ = compute(words, [], hyp, phoneme_active=False)
    assert on.accuracy == pytest.approx((0.9 + 0.8) / 3)
    assert off.accuracy == pytest.approx(2 / 3)


def test_weights_parsing_and_redistribution() -> None:
    assert parse_weights("0.5,0.2,0.15,0.15") == DEFAULT_WEIGHTS
    assert parse_weights("1,1,1,1") == (1.0, 1.0, 1.0, 1.0)
    assert parse_weights("bad") == DEFAULT_WEIGHTS
    assert parse_weights("1,2,3") == DEFAULT_WEIGHTS
    assert parse_weights("-1,1,1,1") == DEFAULT_WEIGHTS
    assert parse_weights("") == DEFAULT_WEIGHTS
    assert overall_score(1.0, 0.5, 0.0, None, (1, 1, 2, 4)) == pytest.approx(1.5 / 4)
    assert overall_score(1.0, 0.5, 0.0, 1.0, (1, 1, 2, 4)) == pytest.approx(5.5 / 8)


def test_long_pause_after_punctuation_is_ignored() -> None:
    text = "Phishing is common. Train every user"
    refs = reference_words(text)
    hyp = [
        HeardWord("phishing", 0.0, 0.4, 0.9),
        HeardWord("is", 0.5, 0.7, 0.9),
        HeardWord("common.", 0.8, 1.2, 0.9),
        HeardWord("train", 2.4, 2.7, 0.9),  # 1.2 s after the period: fine
        HeardWord("every", 2.8, 3.0, 0.9),
        HeardWord("user", 4.2, 4.5, 0.9),  # 1.2 s mid-sentence: a long pause
    ]
    words, _ = align(refs, hyp)
    assert count_long_pauses(hyp) == 2  # without the reference both count
    assert count_long_pauses(hyp, words=words, text=text) == 1
    _, metrics = compute(words, [], hyp, text=text)
    assert metrics["long_pauses"] == 1


def test_ending_variants() -> None:
    assert is_ending_variant("organization's", "organizations")
    assert is_ending_variant("organization", "organization's")
    assert is_ending_variant("organizations'", "organization")
    assert is_ending_variant("process", "processes")
    assert is_ending_variant("its", "it's")
    assert not is_ending_variant("organization", "organization")
    assert not is_ending_variant("is", "i")
    assert not is_ending_variant("threat", "treat")
    words, _ = align(reference_words("The organization's data"), [
        HeardWord("the", 0.0, 0.2, 0.9), HeardWord("organizations", 0.3, 0.9, 0.95), HeardWord("data", 1.0, 1.3, 0.9),
    ])
    assert (words[1].status, words[1].reason) == ("weak", "ending")
    words, _ = align(reference_words("The threat"), [HeardWord("the", 0.0, 0.2, 0.9), HeardWord("treat", 0.3, 0.6, 0.9)])
    assert (words[1].status, words[1].reason) == ("mispronounced", "substitution")
    words, _ = align(reference_words("The threat"), [HeardWord("the", 0.0, 0.2, 0.3), HeardWord("threat", 0.3, 0.6, 0.9)])
    assert (words[0].status, words[0].reason) == ("weak", "low_confidence")
    assert (words[1].status, words[1].reason) == ("ok", None)


def test_tips_from_bad_phonemes() -> None:
    def ph(ipa: str, heard: str, quality: str) -> dict:
        return {"ipa": ipa, "score": 0.2 if quality == "bad" else 0.9, "heard": heard, "quality": quality}

    words = [
        aligned("mispronounced", 0, "threat", phonemes=[ph("θ", "t", "bad"), ph("ɹ", "ɹ", "good")]),
        aligned("ok", 1, "think", phonemes=[ph("θ", "t", "bad"), ph("ɪ", "iː", "bad")]),
        aligned("ok", 2, "three", phonemes=[ph("θ", "t", "bad"), ph("ɹ", "ɹ", "bad")]),  # heard == ipa: skipped
        aligned("ok", 3, "very", phonemes=[ph("v", "w", "bad"), ph("ɛ", "ɛ", "fair")]),
        aligned("ok", 4, "this", phonemes=[ph("ð", "d", "bad")]),
        aligned("missed", 5, "that"),
    ]
    tips = phoneme_tips_from_scores(words)
    assert len(tips) == 3
    assert tips[0] == {"code": "phoneme_confusion", "expected": "θ", "heard": "t", "examples": ["threat", "think", "three"]}
    assert {(t["expected"], t["heard"]) for t in tips[1:]} <= {("ɪ", "iː"), ("v", "w"), ("ð", "d")}
