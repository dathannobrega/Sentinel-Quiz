"""Scores, metrics and tips for a read-aloud attempt (contract 2 §2.4, replaces 1 §4.7).

All formulas are deliberately simple and documented in the contract so the web
client can explain them to the learner:

* word_acc      = missed 0; mispronounced by substitution 0.25; otherwise the word's
                  ``phoneme_score`` when the phoneme engine ran, else ok 1 / weak 0.5 /
                  mispronounced 0
* accuracy      = mean(word_acc)
* completeness  = (reference_words - missed) / reference_words
* fluency       = clamp(1 - 0.5 * wpm_penalty - 0.1 * long_pauses - 0.05 * extras, 0, 1)
                  where a long pause after punctuation does not count
* overall       = weighted mean with SPEECH_SCORE_WEIGHTS (accuracy, completeness,
                  fluency, prosody); without prosody its weight is redistributed
                  proportionally over the other three
"""
from __future__ import annotations

import logging
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher

from .alignment import AlignedWord, Extra
from .engines.base import HeardWord

logger = logging.getLogger("speech.scoring")

TARGET_WPM = (120.0, 170.0)
WPM_PENALTY_SPAN = 60.0  # distance (in wpm) to the target range that costs the full penalty
LONG_PAUSE_SECONDS = 0.8
IPA_IGNORED = set("ˈˌ ‿.")  # stress marks and joiners are not phoneme confusions
PAUSE_PUNCT = set(",.;:!?")
DEFAULT_WEIGHTS: tuple[float, float, float, float] = (0.5, 0.2, 0.15, 0.15)
SUBSTITUTION_ACC = 0.25


@dataclass(slots=True)
class Scores:
    accuracy: float
    completeness: float
    fluency: float
    overall: float
    prosody: float | None = None

    def as_dict(self) -> dict[str, float | None]:
        r = lambda v: None if v is None else round(v, 3)  # noqa: E731
        return {
            "accuracy": r(self.accuracy),
            "completeness": r(self.completeness),
            "fluency": r(self.fluency),
            "prosody": r(self.prosody),
            "overall": r(self.overall),
        }


def parse_weights(raw: str | Sequence[float] | None) -> tuple[float, float, float, float]:
    """``"0.5,0.2,0.15,0.15"`` -> 4 non-negative weights; defaults on anything invalid."""
    if raw is None or raw == "":
        return DEFAULT_WEIGHTS
    try:
        parts = [float(p) for p in raw.split(",")] if isinstance(raw, str) else [float(p) for p in raw]
    except ValueError:
        logger.warning("invalid SPEECH_SCORE_WEIGHTS %r; using defaults", raw)
        return DEFAULT_WEIGHTS
    if len(parts) != 4 or any(p < 0 for p in parts) or sum(parts[:3]) <= 0:
        logger.warning("SPEECH_SCORE_WEIGHTS needs 4 non-negative numbers; got %r; using defaults", raw)
        return DEFAULT_WEIGHTS
    return parts[0], parts[1], parts[2], parts[3]


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def speech_window(heard: list[HeardWord]) -> tuple[float | None, float | None]:
    """First start and last end over everything the ASR heard."""
    if not heard:
        return None, None
    return min(w.start for w in heard), max(w.end for w in heard)


def _punctuated_ends(words: Sequence[AlignedWord] | None, text: str | None) -> set[float]:
    """End times of aligned words that the reference follows with punctuation."""
    if not words or not text:
        return set()
    ends: set[float] = set()
    ordered = sorted(words, key=lambda w: w.index)
    for i, word in enumerate(ordered):
        if word.end is None:
            continue
        stop = ordered[i + 1].char_start if i + 1 < len(ordered) else len(text)
        if set(text[word.char_end : stop]) & PAUSE_PUNCT:
            ends.add(round(word.end, 3))
    return ends


def count_long_pauses(
    heard: list[HeardWord], threshold: float = LONG_PAUSE_SECONDS,
    words: Sequence[AlignedWord] | None = None, text: str | None = None,
) -> int:
    """Gaps longer than ``threshold`` between heard words, except after punctuation.

    A pause is excused when the heard word before it is aligned to a reference word
    that the reference text follows with ``, . ; : ! ?``. Whisper's own punctuation is
    ignored on purpose: it tends to put a comma wherever the reader paused.
    """
    ordered = sorted(heard, key=lambda w: w.start)
    excused_ends = _punctuated_ends(words, text)
    pauses = 0
    for prev, nxt in zip(ordered, ordered[1:]):
        if nxt.start - prev.end <= threshold:
            continue
        if round(prev.end, 3) in excused_ends:
            continue
        pauses += 1
    return pauses


def wpm_penalty(wpm: float | None) -> float:
    if wpm is None:
        return 0.0
    low, high = TARGET_WPM
    if low <= wpm <= high:
        return 0.0
    distance = low - wpm if wpm < low else wpm - high
    return _clamp01(distance / WPM_PENALTY_SPAN)


def word_accuracy(word: AlignedWord, phoneme_active: bool) -> float:
    if word.status == "missed":
        return 0.0
    if word.status == "mispronounced" and word.reason == "substitution":
        return SUBSTITUTION_ACC
    if phoneme_active and word.phoneme_score is not None:
        return float(word.phoneme_score)
    return {"ok": 1.0, "weak": 0.5}.get(word.status, 0.0)


def overall_score(
    accuracy: float, completeness: float, fluency: float, prosody: float | None,
    weights: Sequence[float] = DEFAULT_WEIGHTS,
) -> float:
    wa, wc, wf, wp = weights
    if prosody is None:
        total = wa + wc + wf
        return (wa * accuracy + wc * completeness + wf * fluency) / total if total > 0 else 0.0
    total = wa + wc + wf + wp
    return (wa * accuracy + wc * completeness + wf * fluency + wp * prosody) / total if total > 0 else 0.0


def compute(
    words: list[AlignedWord], extras: list[Extra], heard: list[HeardWord], *,
    text: str | None = None, prosody: float | None = None,
    weights: Sequence[float] = DEFAULT_WEIGHTS, phoneme_active: bool = False,
) -> tuple[Scores, dict]:
    """Return (scores, metrics) for an aligned attempt."""
    counts = Counter(w.status for w in words)
    n_ref = len(words)
    ok, weak, missed = counts.get("ok", 0), counts.get("weak", 0), counts.get("missed", 0)
    mispronounced = counts.get("mispronounced", 0)
    n_extra = len(extras)

    first, last = speech_window(heard)
    speech_seconds = (last - first) if first is not None and last is not None else 0.0
    attempted = n_ref - missed
    wpm: float | None = None
    if speech_seconds > 0 and attempted > 0:
        wpm = attempted / speech_seconds * 60.0
    pauses = count_long_pauses(heard, words=words, text=text)

    if n_ref == 0 or not heard:
        scores = Scores(0.0, 0.0, 0.0, 0.0, None)
    else:
        accuracy = sum(word_accuracy(w, phoneme_active) for w in words) / n_ref
        completeness = (n_ref - missed) / n_ref
        fluency = _clamp01(1.0 - 0.5 * wpm_penalty(wpm) - 0.1 * pauses - 0.05 * n_extra)
        overall = overall_score(accuracy, completeness, fluency, prosody, weights)
        scores = Scores(accuracy, completeness, fluency, overall, prosody)

    metrics = {
        "reference_words": n_ref,
        "ok": ok,
        "weak": weak,
        "mispronounced": mispronounced,
        "missed": missed,
        "extra": n_extra,
        "wpm": round(wpm, 1) if wpm is not None else None,
        "long_pauses": pauses,
        "target_wpm": [int(TARGET_WPM[0]), int(TARGET_WPM[1])],
        "speech_seconds": round(speech_seconds, 3),
    }
    return scores, metrics


def _ipa_chars(ipa: str) -> list[str]:
    return [ch for ch in ipa if ch not in IPA_IGNORED]


def phoneme_tips(words: list[AlignedWord], limit: int = 3) -> list[dict]:
    """Without the phoneme engine: expected->heard confusions from a char diff of IPA.

    A char-level diff of the two IPA strings is crude (no phoneme segmentation of
    digraphs) but it catches the classic learner confusions: θ->t, ð->d, ɪ->i, v->w.
    """
    confusions: Counter[tuple[str, str]] = Counter()
    examples: dict[tuple[str, str], list[str]] = defaultdict(list)
    for word in words:
        if word.status != "mispronounced" or not word.expected_ipa or not word.heard_ipa:
            continue
        expected, heard = _ipa_chars(word.expected_ipa), _ipa_chars(word.heard_ipa)
        matcher = SequenceMatcher(a=expected, b=heard, autojunk=False)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag != "replace" or (i2 - i1) > 2 or (j2 - j1) > 2:
                continue
            key = ("".join(expected[i1:i2]), "".join(heard[j1:j2]))
            confusions[key] += 1
            if word.text not in examples[key] and len(examples[key]) < 3:
                examples[key].append(word.text)
    return _tips(confusions, examples, limit)


def phoneme_tips_from_scores(words: list[AlignedWord], limit: int = 3) -> list[dict]:
    """With the phoneme engine: the most frequent ``bad`` phonemes (expected x heard)."""
    confusions: Counter[tuple[str, str]] = Counter()
    examples: dict[tuple[str, str], list[str]] = defaultdict(list)
    for word in words:
        for ph in word.phonemes or []:
            if ph.get("quality") != "bad" or not ph.get("heard") or ph["heard"] == ph["ipa"]:
                continue
            key = (ph["ipa"], ph["heard"])
            confusions[key] += 1
            if word.text not in examples[key] and len(examples[key]) < 3:
                examples[key].append(word.text)
    return _tips(confusions, examples, limit)


def _tips(confusions: Counter[tuple[str, str]], examples: dict[tuple[str, str], list[str]], limit: int) -> list[dict]:
    return [
        {"code": "phoneme_confusion", "expected": exp, "heard": got, "examples": examples[(exp, got)]}
        for (exp, got), _count in confusions.most_common(limit)
    ]
