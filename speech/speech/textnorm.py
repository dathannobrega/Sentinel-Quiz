"""Tokenization and normalization shared by TTS word mapping and ASR alignment.

Two different tokenizers on purpose:

* :func:`display_tokens` keeps the *original* text intact and returns exact character
  offsets, so the web client can highlight ``text[char_start:char_end]`` without
  re-tokenizing. It must round-trip: ``text[start:end] == token``.
* :func:`normalize_word` / :func:`normalize_text` produce the comparable form used by
  the aligner: lowercase, no punctuation, numbers spelled out, apostrophes kept
  ("don't" vs "dont" is a real difference in what was said).

:func:`split_sentences` is the synthesis/cache unit of contract 3 §2.1: the same
boundary rule as the reading corpus (``material_corpus._SENTENCE_BREAK``), with short
fragments merged into a neighbour and a hard cap on sentence length.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# A display word is a maximal run of letters/digits/apostrophes/hyphens, optionally
# followed by a percent sign (so "50%" is one word read as "fifty percent"). A bare
# ampersand is a word too (read as "and").
_WORD_RE = re.compile(r"(?:[^\W_]|['’\-])+%?|&")
_ALNUM_RE = re.compile(r"[^\W_]")
_APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "`": "'"})

_ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
_ORDINAL_IRREGULAR = {
    "one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
    "nine": "ninth", "twelve": "twelfth",
}
_SYMBOLS = {"&": "and", "%": "percent", "+": "plus", "@": "at", "$": "dollars"}


@dataclass(frozen=True, slots=True)
class DisplayToken:
    text: str
    char_start: int
    char_end: int


def display_tokens(text: str) -> list[DisplayToken]:
    """Split ``text`` into highlightable words with exact offsets into ``text``."""
    out: list[DisplayToken] = []
    for match in _WORD_RE.finditer(text):
        token = match.group(0)
        if token == "&" or _ALNUM_RE.search(token):
            out.append(DisplayToken(token, match.start(), match.end()))
    return out


def number_to_words(n: int) -> str:
    """Spell out an integer in 0..9999 the way a reader would say it."""
    if n < 0 or n > 9999:
        return str(n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        return _TENS[tens] if ones == 0 else f"{_TENS[tens]}-{_ONES[ones]}"
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        head = f"{_ONES[hundreds]} hundred"
        return head if rest == 0 else f"{head} {number_to_words(rest)}"
    thousands, rest = divmod(n, 1000)
    head = f"{_ONES[thousands]} thousand"
    return head if rest == 0 else f"{head} {number_to_words(rest)}"


def ordinal_to_words(n: int) -> str:
    words = number_to_words(n)
    head, sep, last = words.rpartition(" ") if " " in words else ("", "", words)
    if "-" in last:
        prefix, _, last = last.rpartition("-")
        prefix += "-"
    else:
        prefix = ""
    if last in _ORDINAL_IRREGULAR:
        last_ord = _ORDINAL_IRREGULAR[last]
    elif last.endswith("y"):
        last_ord = last[:-1] + "ieth"
    else:
        last_ord = last + "th"
    return f"{head}{sep}{prefix}{last_ord}"


_INT_RE = re.compile(r"^\d{1,4}$")
_ORD_RE = re.compile(r"^(\d{1,4})(st|nd|rd|th)$")


def normalize_word(raw: str) -> str:
    """Comparable form of one word; may contain spaces when a number expands.

    Returns "" for tokens that carry nothing pronounceable (pure punctuation).
    """
    word = raw.strip().lower().translate(_APOSTROPHES)
    if not word:
        return ""
    if word in _SYMBOLS:
        return _SYMBOLS[word]
    suffix = ""
    if word.endswith("%"):
        word, suffix = word[:-1], " percent"
    # Drop anything that is not a letter, digit, apostrophe or hyphen, then trim the
    # apostrophes/hyphens that only wrap the word ("'cause", "--").
    word = "".join(ch for ch in word if ch.isalnum() or ch in "'-")
    word = word.strip("'-")
    if not word:
        return suffix.strip()
    if _INT_RE.match(word):
        word = number_to_words(int(word))
    else:
        ordinal = _ORD_RE.match(word)
        if ordinal:
            word = ordinal_to_words(int(ordinal.group(1)))
    return word + suffix


def normalize_text(text: str) -> list[str]:
    """Normalized tokens of free text (ASR output), one entry per spoken word."""
    out: list[str] = []
    for token in display_tokens(text):
        norm = normalize_word(token.text)
        if norm:
            out.extend(norm.split(" "))
    return out


def compare_key(norm: str) -> str:
    """Equality key for two normalized words: hyphens are inaudible ("multi-factor")."""
    return norm.replace("-", "").replace(" ", "")


# ------------------------------------------------------------------ sentences
# Must stay identical to backend/app/services/material_corpus.py::_SENTENCE_BREAK so a
# block of the reader splits into the same sentences the corpus (and the drill) use.
_SENTENCE_BREAK = re.compile(r"(?<=[.!?:])\s+(?=[A-Z0-9“\"(•])")
MIN_SENTENCE_WORDS = 3
MAX_SENTENCE_CHARS = 400
# A comma this far from the middle (fraction of the length) still beats a plain space.
_COMMA_WINDOW = 0.25


def _raw_sentence_spans(text: str) -> list[tuple[int, int]]:
    """Corpus boundaries; offsets exclude surrounding whitespace (same as ``sentence_spans``)."""
    spans: list[tuple[int, int]] = []
    cursor = 0
    for match in [*_SENTENCE_BREAK.finditer(text), None]:
        end = match.start() if match is not None else len(text)
        start = cursor
        while start < end and text[start].isspace():
            start += 1
        stop = end
        while stop > start and text[stop - 1].isspace():
            stop -= 1
        if stop > start:
            spans.append((start, stop))
        if match is not None:
            cursor = match.end()
    return spans


def _word_count(text: str, span: tuple[int, int]) -> int:
    return len(display_tokens(text[span[0]:span[1]]))


def _merge_short(text: str, spans: list[tuple[int, int]], min_words: int) -> list[tuple[int, int]]:
    """Glue fragments shorter than ``min_words`` to the previous sentence (or the next one
    when they open the block). A merged span keeps the whitespace between the parts."""
    out: list[tuple[int, int]] = []
    pending: tuple[int, int] | None = None  # a short opener waiting for the next sentence
    for span in spans:
        if pending is not None:
            span = (pending[0], span[1])
            pending = None
        if _word_count(text, span) >= min_words:
            out.append(span)
        elif out:
            out[-1] = (out[-1][0], span[1])
        else:
            pending = span
    if pending is not None:
        out.append(pending)
    return out


def _split_long(text: str, span: tuple[int, int], max_chars: int) -> list[tuple[int, int]]:
    """Cut a span longer than ``max_chars`` at the comma (else space) nearest its middle, recursively."""
    start, end = span
    if end - start <= max_chars:
        return [span]
    middle = (start + end) // 2
    segment = text[start:end]
    # Break positions are whitespace characters: the left part ends before them and the
    # right part starts after them, so no character is lost or duplicated.
    commas = [start + m.end() - 1 for m in re.finditer(r",\s", segment)]
    spaces = [start + m.start() for m in re.finditer(r"\s", segment)]
    cut: int | None = None
    if commas:
        best = min(commas, key=lambda pos: abs(pos - middle))
        if abs(best - middle) <= _COMMA_WINDOW * (end - start):
            cut = best
    if cut is None and spaces:
        cut = min(spaces, key=lambda pos: abs(pos - middle))
    if cut is None or cut <= start or cut >= end - 1:
        # One giant token: hard split in the middle (never happens with real prose).
        return [*_split_long(text, (start, middle), max_chars), *_split_long(text, (middle, end), max_chars)]
    left_end = cut
    while left_end > start and text[left_end - 1].isspace():
        left_end -= 1
    right_start = cut
    while right_start < end and text[right_start].isspace():
        right_start += 1
    parts: list[tuple[int, int]] = []
    if left_end > start:
        parts += _split_long(text, (start, left_end), max_chars)
    if right_start < end:
        parts += _split_long(text, (right_start, end), max_chars)
    return parts


def split_sentences(
    text: str, *, min_words: int = MIN_SENTENCE_WORDS, max_chars: int = MAX_SENTENCE_CHARS
) -> list[tuple[int, int]]:
    """``(char_start, char_end)`` of each sentence of ``text`` (contract 3 §2.1).

    Boundaries come from the corpus regex; fragments with fewer than ``min_words`` words
    are merged into a neighbour; nothing longer than ``max_chars`` survives. Spans index
    ``text`` directly, never overlap and exclude surrounding whitespace.
    """
    text = text or ""
    spans = _merge_short(text, _raw_sentence_spans(text), min_words)
    out: list[tuple[int, int]] = []
    for span in spans:
        out.extend(_split_long(text, span, max_chars))
    return out
