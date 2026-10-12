"""Word-level alignment between a reference text and what the ASR heard.

Needleman-Wunsch / weighted Levenshtein over normalized tokens. Substitutions cost
``1 - similarity`` so that "vulnerability" read as "vulnerable" is aligned as one
mispronounced word instead of a deletion plus an insertion (which would cost 2).

Reference tokens that normalize to several spoken words ("50%" -> "fifty percent")
may consume the matching number of hypothesis tokens, so a correct reading of a
number is not reported as an extra.
"""
from __future__ import annotations

from dataclasses import dataclass

from rapidfuzz import fuzz

from .engines.base import HeardWord
from .textnorm import DisplayToken, compare_key, display_tokens, normalize_word

OK_CONFIDENCE = 0.6  # below this an aligned word is "weak" (the model hesitated)
SIMILAR_RATIO = 50.0  # rapidfuzz ratio (0-100) from which a substitution is "similar"

DELETE_COST = 1.0
INSERT_COST = 1.0


@dataclass(frozen=True, slots=True)
class RefWord:
    index: int
    text: str
    char_start: int
    char_end: int
    norm: str  # normalized form, may contain spaces (number expansion)

    @property
    def span(self) -> int:
        """Number of spoken words this reference token may expand to.

        Numbers expand to several words ("50%" -> "fifty percent") and ASR engines often
        split hyphenated compounds ("fixed-length" -> "fixed", "-length"), so both
        separators count. ``compare_key`` ignores hyphens and spaces, which makes the
        joined span compare equal to the reference token.
        """
        return len(self.norm.replace("-", " ").split()) if self.norm else 1


@dataclass(slots=True)
class AlignedWord:
    index: int
    text: str
    char_start: int
    char_end: int
    status: str  # ok | weak | mispronounced | missed
    heard: str | None
    confidence: float | None
    start: float | None
    end: float | None
    expected_ipa: str | None = None
    heard_ipa: str | None = None
    # null | substitution | phoneme (mispronounced) | ending | low_confidence (weak)
    reason: str | None = None
    phoneme_score: float | None = None
    phonemes: list[dict] | None = None
    brk: str | None = None  # prosody break: null | unexpected | missing


@dataclass(slots=True)
class Extra:
    text: str
    after_index: int
    start: float
    end: float


def reference_words(text: str) -> list[RefWord]:
    """Display tokens of the reference with their normalized comparison form.

    Tokens with nothing pronounceable (a lone hyphen between spaces) are skipped so
    they are never reported as missed.
    """
    out: list[RefWord] = []
    for token in display_tokens(text):
        norm = normalize_word(token.text)
        if not norm:
            continue
        out.append(RefWord(len(out), token.text, token.char_start, token.char_end, norm))
    return out


def _substitution_cost(ref_norm: str, hyp_norm: str) -> float:
    if compare_key(ref_norm) == compare_key(hyp_norm):
        return 0.0
    ratio = fuzz.ratio(compare_key(ref_norm), compare_key(hyp_norm))
    if ratio >= SIMILAR_RATIO:
        return 1.0 - ratio / 100.0
    return 1.0


_ENDING_SUFFIXES = ("'s", "s'", "'", "es", "s")


def _ending_stems(key: str) -> set[str]:
    stems = {key}
    for suffix in _ENDING_SUFFIXES:
        if key.endswith(suffix) and len(key) - len(suffix) >= 3:
            stems.add(key[: -len(suffix)])
    return stems


def is_ending_variant(ref_norm: str, hyp_norm: str) -> bool:
    """True when two different words only differ in a possessive/plural ending.

    ``organization's`` / ``organizations`` / ``organizations'`` vs ``organization`` (and
    apostrophe-only differences such as ``its`` / ``it's``, which sound the same).
    """
    ref, hyp = compare_key(ref_norm), compare_key(hyp_norm)
    if not ref or not hyp or ref == hyp:
        return False
    if ref.replace("'", "") == hyp.replace("'", ""):
        return True
    return bool(_ending_stems(ref) & _ending_stems(hyp))


def _round(value: float | None) -> float | None:
    return None if value is None else round(float(value), 3)


def align(
    reference: list[RefWord], heard: list[HeardWord], weak_confidence: float = OK_CONFIDENCE
) -> tuple[list[AlignedWord], list[Extra]]:
    """Align reference words with heard words; returns per-word status and extras.

    Status/reason: same word -> ``ok`` (``weak`` + ``low_confidence`` under
    ``weak_confidence``); only the possessive/plural ending differs -> ``weak`` +
    ``ending``; any other word -> ``mispronounced`` + ``substitution``.
    """
    hyp_norm = [normalize_word(w.text) for w in heard]
    n, m = len(reference), len(heard)
    INF = float("inf")
    # cost[i][j]: best cost aligning reference[:i] with heard[:j]
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    back: list[list[tuple[str, int] | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0.0
    for j in range(1, m + 1):
        cost[0][j] = cost[0][j - 1] + INSERT_COST
        back[0][j] = ("ins", 1)
    for i in range(1, n + 1):
        cost[i][0] = cost[i - 1][0] + DELETE_COST
        back[i][0] = ("del", 0)
        ref = reference[i - 1]
        for j in range(1, m + 1):
            best = cost[i - 1][j - 1] + _substitution_cost(ref.norm, hyp_norm[j - 1])
            choice: tuple[str, int] = ("sub", 1)
            if ref.span > 1 and j >= ref.span:
                joined = " ".join(hyp_norm[j - ref.span : j])
                span_cost = cost[i - 1][j - ref.span] + _substitution_cost(ref.norm, joined)
                if span_cost < best:
                    best, choice = span_cost, ("sub", ref.span)
            if cost[i - 1][j] + DELETE_COST < best:
                best, choice = cost[i - 1][j] + DELETE_COST, ("del", 0)
            if cost[i][j - 1] + INSERT_COST < best:
                best, choice = cost[i][j - 1] + INSERT_COST, ("ins", 1)
            cost[i][j] = best
            back[i][j] = choice

    # Backtrace into (ref_index | None, [hyp indices]) operations.
    ops: list[tuple[int | None, list[int]]] = []
    i, j = n, m
    while i > 0 or j > 0:
        kind, width = back[i][j]  # type: ignore[misc]
        if kind == "sub":
            ops.append((i - 1, list(range(j - width, j))))
            i, j = i - 1, j - width
        elif kind == "del":
            ops.append((i - 1, []))
            i -= 1
        else:
            ops.append((None, [j - 1]))
            j -= 1
    ops.reverse()

    words: list[AlignedWord] = []
    extras: list[Extra] = []
    last_ref_index = -1
    for ref_index, hyp_indices in ops:
        if ref_index is None:
            h = heard[hyp_indices[0]]
            extras.append(Extra(text=hyp_norm[hyp_indices[0]] or h.text, after_index=last_ref_index, start=_round(h.start) or 0.0, end=_round(h.end) or 0.0))
            continue
        ref = reference[ref_index]
        last_ref_index = ref_index
        if not hyp_indices:
            words.append(AlignedWord(ref.index, ref.text, ref.char_start, ref.char_end, "missed", None, None, None, None))
            continue
        chunk = [heard[k] for k in hyp_indices]
        heard_text = " ".join(hyp_norm[k] or heard[k].text for k in hyp_indices)
        confidence = sum(w.probability for w in chunk) / len(chunk)
        reason: str | None = None
        if compare_key(ref.norm) == compare_key(heard_text):
            status = "ok" if confidence >= weak_confidence else "weak"
            reason = None if status == "ok" else "low_confidence"
        elif is_ending_variant(ref.norm, heard_text):
            status, reason = "weak", "ending"
        else:
            status, reason = "mispronounced", "substitution"
        words.append(
            AlignedWord(
                ref.index, ref.text, ref.char_start, ref.char_end, status, heard_text,
                _round(confidence), _round(chunk[0].start), _round(chunk[-1].end), reason=reason,
            )
        )
    return words, extras


__all__ = ["AlignedWord", "Extra", "RefWord", "DisplayToken", "align", "is_ending_variant", "reference_words", "OK_CONFIDENCE"]
