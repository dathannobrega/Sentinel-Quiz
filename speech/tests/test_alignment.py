from __future__ import annotations

from speech.alignment import align, reference_words
from speech.engines.base import HeardWord

REFERENCE = "Security awareness training teaches employees to recognize a vulnerability."


def heard(words: list[str], prob: float = 0.95, gap: float = 0.05, length: float = 0.3) -> list[HeardWord]:
    out = []
    t = 0.0
    for w in words:
        out.append(HeardWord(text=w, start=round(t, 3), end=round(t + length, 3), probability=prob))
        t += length + gap
    return out


def statuses(words) -> list[str]:
    return [w.status for w in words]


def test_perfect_read_all_ok() -> None:
    refs = reference_words(REFERENCE)
    words, extras = align(refs, heard(["security", "awareness", "training", "teaches", "employees", "to", "recognize", "a", "vulnerability."]))
    assert statuses(words) == ["ok"] * 9
    assert extras == []
    assert words[0].heard == "security"
    assert words[0].confidence == 0.95
    assert words[0].start == 0.0 and words[0].end == 0.3
    assert words[-1].text == "vulnerability" and words[-1].char_start == REFERENCE.index("vulnerability")


def test_skipped_word_is_missed() -> None:
    refs = reference_words(REFERENCE)
    words, extras = align(refs, heard(["security", "awareness", "teaches", "employees", "to", "recognize", "a", "vulnerability"]))
    assert statuses(words) == ["ok", "ok", "missed", "ok", "ok", "ok", "ok", "ok", "ok"]
    missed = words[2]
    assert missed.text == "training" and missed.heard is None and missed.start is None and missed.confidence is None
    assert extras == []


def test_similar_substitution_is_mispronounced_with_heard() -> None:
    refs = reference_words(REFERENCE)
    words, extras = align(refs, heard(["security", "awareness", "training", "teaches", "employees", "to", "recognize", "a", "vulnerable"]))
    assert statuses(words)[:-1] == ["ok"] * 8
    last = words[-1]
    assert last.status == "mispronounced"
    assert last.heard == "vulnerable"
    assert last.start is not None and last.end is not None
    assert extras == []


def test_insertion_becomes_extra_with_anchor() -> None:
    refs = reference_words(REFERENCE)
    words, extras = align(refs, heard(["security", "awareness", "um", "training", "teaches", "employees", "to", "recognize", "a", "vulnerability"]))
    assert statuses(words) == ["ok"] * 9
    assert len(extras) == 1
    assert extras[0].text == "um" and extras[0].after_index == 1
    assert extras[0].start == 0.7


def test_leading_insertion_anchors_before_first_word() -> None:
    refs = reference_words("hello world")
    _words, extras = align(refs, heard(["so", "hello", "world"]))
    assert len(extras) == 1 and extras[0].after_index == -1


def test_low_probability_is_weak() -> None:
    refs = reference_words("Security awareness training")
    hyp = heard(["security", "awareness", "training"])
    hyp[1].probability = 0.4
    words, _ = align(refs, hyp)
    assert statuses(words) == ["ok", "weak", "ok"]
    assert words[1].heard == "awareness" and words[1].confidence == 0.4


def test_dissimilar_substitution_still_mispronounced() -> None:
    refs = reference_words("the quick fox")
    words, extras = align(refs, heard(["the", "banana", "fox"]))
    assert statuses(words) == ["ok", "mispronounced", "ok"]
    assert words[1].heard == "banana"
    assert extras == []


def test_number_expansion_matches_span_of_heard_words() -> None:
    refs = reference_words("Nearly 50% of breaches start with phishing.")
    words, extras = align(refs, heard(["nearly", "fifty", "percent", "of", "breaches", "start", "with", "phishing"]))
    assert statuses(words) == ["ok"] * 7
    assert words[1].text == "50%" and words[1].heard == "fifty percent"
    assert words[1].start == 0.35 and words[1].end == 1.0
    assert extras == []


def test_digits_on_both_sides_normalize_equal() -> None:
    refs = reference_words("Published in 2024.")
    words, _ = align(refs, heard(["Published", "in", "2024."]))
    assert statuses(words) == ["ok"] * 3


def test_hyphen_insensitive_match_and_curly_apostrophe() -> None:
    refs = reference_words("Multi-factor authentication doesn’t hurt.")
    words, _ = align(refs, heard(["multifactor", "authentication", "doesn't", "hurt"]))
    assert statuses(words) == ["ok"] * 4


def test_hyphenated_compound_split_by_asr_is_ok() -> None:
    # faster-whisper emits "fixed" and "-length" as two words for "fixed-length".
    refs = reference_words("A hash function produces a fixed-length digest.")
    words, extras = align(refs, heard(["a", "hash", "function", "produces", "a", "fixed", "-length", "digest"]))
    assert statuses(words) == ["ok"] * 7
    compound = words[5]
    assert compound.text == "fixed-length" and compound.heard == "fixed length"
    assert compound.start == 1.75 and compound.end == 2.4
    assert extras == []


def test_nothing_heard_all_missed() -> None:
    refs = reference_words("one two three")
    words, extras = align(refs, [])
    assert statuses(words) == ["missed"] * 3
    assert extras == []
