"""Per-session option shuffling (M-C1).

When a question is added to an exam/study session a random permutation of its
option keys is stored in ``option_order_json`` (JSON list of *original* keys in the
order shown to the student). While serving, options are relabelled ``A, B, C...`` in
that order (display keys). Answers arrive in display keys and are mapped back to the
original keys before grading, so ``selected_keys`` rows, analytics and the answer key
always use original keys. Feedback and review screens translate original keys back
into the display keys of that session.

Sessions created before the shuffle existed have ``option_order_json = NULL`` and keep
the original keys and order (identity mapping).
"""
from __future__ import annotations

import json
import random
import re
import string
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Option

DISPLAY_LABELS = string.ascii_uppercase
# "Option A: ..." / "Alternativa B) ..." prefixes would contradict the relabelled key.
_LEADING_LABEL = re.compile(r"^\s*(?:option|opção|opcao|alternativa|alternative)\s+[A-Za-z]\s*[:.)\-–]\s*", re.IGNORECASE)

_rng = random.SystemRandom()


def _natural_key(value: str) -> tuple:
    return (len(value), value)


def option_keys_by_question(db: Session, question_ids: Iterable[str]) -> dict[str, list[str]]:
    ids = [qid for qid in dict.fromkeys(question_ids) if qid]
    if not ids:
        return {}
    grouped: dict[str, list[str]] = defaultdict(list)
    for question_id, key in db.execute(
        select(Option.question_id, Option.key).where(Option.question_id.in_(ids))
    ).all():
        grouped[question_id].append(key)
    return {qid: sorted(keys, key=_natural_key) for qid, keys in grouped.items()}


def generate_option_order(option_keys: Sequence[str], rng: Optional[random.Random] = None) -> Optional[str]:
    """JSON permutation of ``option_keys`` (``None`` when there is nothing to shuffle)."""
    keys = [str(key) for key in option_keys if str(key or "").strip()]
    if len(keys) < 2 or len(keys) > len(DISPLAY_LABELS):
        return None
    shuffled = list(keys)
    (rng or _rng).shuffle(shuffled)
    return json.dumps(shuffled, ensure_ascii=True)


def build_option_orders(db: Session, question_ids: Iterable[str], rng: Optional[random.Random] = None) -> dict[str, Optional[str]]:
    """``{question_id: option_order_json}`` for the questions being added to a session."""
    keys_map = option_keys_by_question(db, question_ids)
    return {qid: generate_option_order(keys, rng) for qid, keys in keys_map.items()}


def parse_option_order(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    return [str(item) for item in payload if str(item or "").strip()]


@dataclass
class OptionMapping:
    """Bidirectional display <-> original key mapping for one question in one session."""

    shuffled: bool
    display_to_original: dict[str, str] = field(default_factory=dict)
    original_to_display: dict[str, str] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)  # original keys in display order

    @classmethod
    def build(cls, option_order_json: Optional[str], original_keys: Sequence[str]) -> "OptionMapping":
        originals = sorted({str(key) for key in original_keys}, key=_natural_key)
        order = parse_option_order(option_order_json)
        # Only trust the stored order when it is a permutation of the current keys
        # (an editorial change of the option set falls back to the original order).
        if order and sorted(order, key=_natural_key) == originals and len(order) <= len(DISPLAY_LABELS):
            display = {DISPLAY_LABELS[index]: key for index, key in enumerate(order)}
            return cls(
                shuffled=True,
                display_to_original=display,
                original_to_display={key: label for label, key in display.items()},
                order=list(order),
            )
        identity = {key: key for key in originals}
        return cls(shuffled=False, display_to_original=identity, original_to_display=dict(identity), order=originals)

    def to_original(self, display_keys: Iterable[str]) -> list[str]:
        """Map submitted display keys to original keys; unknown keys raise ``ValueError``."""
        cleaned = [str(key or "").strip() for key in display_keys]
        cleaned = [key for key in cleaned if key]
        invalid = sorted({key for key in cleaned if key not in self.display_to_original})
        if invalid:
            raise ValueError(f"Invalid option key(s): {', '.join(invalid)}")
        return sorted({self.display_to_original[key] for key in cleaned}, key=_natural_key)

    def to_display(self, original_keys: Iterable[str]) -> list[str]:
        mapped = [self.original_to_display[key] for key in original_keys if key in self.original_to_display]
        return sorted(set(mapped), key=_natural_key)

    def display_options(self, options: Sequence[dict]) -> list[dict]:
        """Options (dicts with ``key``) re-keyed and ordered for display."""
        by_key = {str(item["key"]): item for item in options}
        rendered: list[dict] = []
        for original in self.order:
            item = by_key.get(original)
            if item is None:
                continue
            copy = dict(item)
            copy["key"] = self.original_to_display[original]
            if self.shuffled and isinstance(copy.get("text"), str):
                copy["text"] = _LEADING_LABEL.sub("", copy["text"], count=1) or copy["text"]
            rendered.append(copy)
        return rendered

    def remap_text(self, text: Optional[str]) -> Optional[str]:
        """Rewrite explicit option-letter references (original keys) into this session's display keys.

        Official justifications cite letters ("Correct Answer: B", "alternativa C", "(D)", per-option
        lines "A) ..."). Each match is translated in a single pass so swaps (B<->C) never chain.
        Bare letters outside those reference forms are left untouched to avoid rewriting prose;
        per-option line references additionally require an enumeration of >= 2 valid option letters.
        """
        if not text or not self.shuffled:
            return text

        def translate_letters(fragment: str) -> str:
            return _SINGLE_LETTER.sub(lambda m: self.original_to_display.get(m.group(0), m.group(0)), fragment)

        def keyword(match: re.Match) -> str:
            return match.group("prefix") + translate_letters(match.group("letters"))

        def paren(match: re.Match) -> str:
            return f"({translate_letters(match.group('letters'))})"

        def line(match: re.Match) -> str:
            return match.group("prefix") + translate_letters(match.group("letters"))

        # Mark rewritten spans so later passes don't translate them twice.
        sentinel = "\u0000"
        protected: list[str] = []

        def protect(replacement: str) -> str:
            protected.append(replacement)
            return f"{sentinel}{len(protected) - 1}{sentinel}"

        out = _KEYWORD_REFERENCE.sub(lambda m: protect(keyword(m)), text)
        out = _PAREN_REFERENCE.sub(lambda m: protect(paren(m)), out)
        # Per-option lines ("A) ...", "- **B:** ...") are only treated as references when
        # the text really enumerates options: the letter must be an option key of this
        # question and at least two distinct option letters must open lines. A lone
        # sentence such as "A. The firewall..." is prose and stays untouched.
        line_letters = {
            match.group("letters")
            for match in _LINE_REFERENCE.finditer(out)
            if match.group("letters") in self.original_to_display
        }
        if len(line_letters) >= 2:
            out = _LINE_REFERENCE.sub(
                lambda m: protect(line(m)) if m.group("letters") in self.original_to_display else m.group(0),
                out,
            )
        return re.sub(f"{sentinel}(\\d+){sentinel}", lambda m: protected[int(m.group(1))], out)


# Letters stay case-sensitive even inside IGNORECASE patterns ("answer is a ..." is prose, not "A").
_LETTER_LIST = r"(?-i:[A-Z])(?:\s*(?:,|/|\be\b|\bou\b|\band\b|\bor\b)\s*(?-i:[A-Z]))*"
# "Correct Answer:** B", "alternativa C", "opções A e D", "resposta correta é B", "letter B"...
_KEYWORD_REFERENCE = re.compile(
    r"(?P<prefix>\b(?:correct\s+answers?|answers?|options?|choices?|alternatives?|letters?|"
    r"alternativas?|op[çc](?:[aã]o|[oõ]es)|respostas?(?:\s+corretas?)?|letras?|corretas?\s+(?:[ée]|s[aã]o))"
    r"\s*(?:\*\*)?\s*(?:is|are|[ée]|s[aã]o)?\s*[:\-–]?\s*(?:\*\*)?\s*\(?)(?P<letters>" + _LETTER_LIST + r")(?![A-Za-z0-9])",
    re.IGNORECASE,
)
# "(B)" anywhere, and per-option lines such as "B) ...", "- C. ...", "**D:** ...".
_PAREN_REFERENCE = re.compile(r"\((?P<letters>[A-Z])\)")
_LINE_REFERENCE = re.compile(r"(?m)^(?P<prefix>\s*(?:[-*]\s*)?(?:\*\*)?)(?P<letters>[A-Z])(?=(?:\*\*)?[).:](?:\*\*)?\s)")
_SINGLE_LETTER = re.compile(r"(?<![A-Za-z0-9])[A-Z](?![A-Za-z0-9])")


def split_keys(raw: Optional[str]) -> list[str]:
    return [key for key in str(raw or "").split(",") if key]
