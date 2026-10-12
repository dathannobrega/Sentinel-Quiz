"""Scores, metrics and tips for a read-aloud attempt (contract §4.7).

All formulas are deliberately simple and documented in the contract so the web
client can explain them to the learner:

* accuracy      = (ok + 0.5 * weak) / reference_words
* completeness  = (reference_words - missed) / reference_words
* fluency       = clamp(1 - 0.5 * wpm_penalty - 0.1 * long_pauses - 0.05 * extras, 0, 1)
* overall       = 0.6 * accuracy + 0.2 * completeness + 0.2 * fluency
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher

from .alignment import AlignedWord, Extra
from .engines.base import HeardWord

TARGET_WPM = (120.0, 170.0)
WPM_PENALTY_SPAN = 60.0  # distance (in wpm) to the target range that costs the full penalty
LONG_PAUSE_SECONDS = 0.8
IPA_IGNORED = set("ˈˌ ‿.")  # stress marks and joiners are not phoneme confusions


@dataclass(slots=True)
class Scores:
    accuracy: float
    completeness: float
    fluency: float
    overall: float

    def as_dict(self) -> dict[str, float]:
        return {k: round(v, 3) for k, v in asdict(self).items()}


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def speech_window(heard: list[HeardWord]) -> tuple[float | None, float | None]:
    """First start and last end over everything the ASR heard."""
    if not heard:
        return None, None
    return min(w.start for w in heard), max(w.end for w in heard)


def count_long_pauses(heard: list[HeardWord], threshold: float = LONG_PAUSE_SECONDS) -> int:
    ordered = sorted(heard, key=lambda w: w.start)
    pauses = 0
    for prev, nxt in zip(ordered, ordered[1:]):
        if nxt.start - prev.end > threshold:
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


def compute(words: list[AlignedWord], extras: list[Extra], heard: list[HeardWord]) -> tuple[Scores, dict]:
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
    pauses = count_long_pauses(heard)

    if n_ref == 0 or not heard:
        scores = Scores(0.0, 0.0, 0.0, 0.0)
    else:
        accuracy = (ok + 0.5 * weak) / n_ref
        completeness = (n_ref - missed) / n_ref
        fluency = _clamp01(1.0 - 0.5 * wpm_penalty(wpm) - 0.1 * pauses - 0.05 * n_extra)
        overall = 0.6 * accuracy + 0.2 * completeness + 0.2 * fluency
        scores = Scores(accuracy, completeness, fluency, overall)

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
    """Aggregate expected->heard phoneme confusions over mispronounced words.

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
    tips = []
    for (exp, got), _count in confusions.most_common(limit):
        tips.append({"code": "phoneme_confusion", "expected": exp, "heard": got, "examples": examples[(exp, got)]})
    return tips
