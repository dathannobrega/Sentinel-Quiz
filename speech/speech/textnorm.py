"""Tokenization and normalization shared by TTS word mapping and ASR alignment.

Two different tokenizers on purpose:

* :func:`display_tokens` keeps the *original* text intact and returns exact character
  offsets, so the web client can highlight ``text[char_start:char_end]`` without
  re-tokenizing. It must round-trip: ``text[start:end] == token``.
* :func:`normalize_word` / :func:`normalize_text` produce the comparable form used by
  the aligner: lowercase, no punctuation, numbers spelled out, apostrophes kept
  ("don't" vs "dont" is a real difference in what was said).
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
