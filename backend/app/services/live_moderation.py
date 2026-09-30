"""Sentinel Arena moderation (PLANO §7.11, RF-1104/1107/1112/1114).

Two layers of terms:

* built-in pt-BR/en lists (``live_names``) that always apply;
* terms managed by admins in ``live_moderation_term`` (RF-1107): ``block`` adds a term,
  ``allow`` exempts one (e.g. a real surname that collides with a slang token). Each
  term applies to display ``names``, quiz ``content`` or ``all``. Changes are visible to
  every process within ``TERMS_TTL_S`` (the RF asks for ≤1 min), without a deploy.

Content scanning is deliberately high-recall: a match never rejects content by itself,
it only holds it for a human (the version stays ``flagged`` until an admin reviews it).
"""
from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services import live_names

TERMS_TTL_S = 30.0
SCOPES = ("names", "content", "all")
KINDS = ("block", "allow")
MATCHES = ("substring", "token")

# Content terms: the strong substrings of the name list plus unambiguous tokens. Short
# words that are legitimate in quiz content ("pau", "rola", "macaco", "burro"...) are
# left to the admin list.
_CONTENT_TOKENS = frozenset({
    "puta", "puto", "cuzao", "merda", "bosta", "fdp", "vsf", "tnc", "cunt", "shit", "slut", "fag", "porn",
})


@dataclass(frozen=True)
class Term:
    term: str  # folded
    match: str
    kind: str
    scope: str


@dataclass(frozen=True)
class Match:
    term: str
    field: str
    excerpt: str


_cache: tuple[float, tuple[Term, ...]] | None = None
_lock = threading.Lock()


def fold(value: str) -> str:
    return live_names._folded(value)  # noqa: SLF001 - same folding as the name filter


def invalidate_cache() -> None:
    global _cache
    with _lock:
        _cache = None


def admin_terms(db: Session) -> tuple[Term, ...]:
    global _cache
    now = time.monotonic()
    with _lock:
        if _cache is not None and now - _cache[0] < TERMS_TTL_S:
            return _cache[1]
    from app.models import LiveModerationTerm

    rows = db.execute(select(LiveModerationTerm.term, LiveModerationTerm.match, LiveModerationTerm.kind, LiveModerationTerm.scope)).all()
    terms = tuple(Term(fold(t), m, k, s) for t, m, k, s in rows)
    with _lock:
        _cache = (now, terms)
    return terms


def _applies(term: Term, scope: str) -> bool:
    return term.scope == "all" or term.scope == scope


def _tokens(folded: str) -> set[str]:
    tokens = {tok for tok in re.split(r"[^a-z0-9]+", folded) if tok}
    return tokens | {re.sub(r"(.)\1+", r"\1", tok) for tok in tokens}


def _term_hits(text: str, terms: Iterable[Term]) -> list[str]:
    folded = fold(text)
    compact = re.sub(r"[^a-z0-9]+", "", folded)
    squeezed = re.sub(r"(.)\1+", r"\1", compact)
    tokens = _tokens(folded)
    hits = []
    for term in terms:
        if term.match == "substring" and (term.term in compact or term.term in squeezed):
            hits.append(term.term)
        elif term.match == "token" and term.term in tokens:
            hits.append(term.term)
    return hits


def _allowed(text: str, terms: Iterable[Term], scope: str) -> bool:
    """True when an admin ``allow`` term covers this text (whole-token)."""
    allow = [t for t in terms if t.kind == "allow" and _applies(t, scope)]
    if not allow:
        return False
    tokens = _tokens(fold(text))
    return any(t.term in tokens or t.term == re.sub(r"[^a-z0-9]+", "", fold(text)) for t in allow)


def name_is_offensive(db: Session | None, display_name: str) -> bool:
    """Built-in list + admin terms (RF-1107); admin ``allow`` terms win over the built-in list."""
    terms = admin_terms(db) if db is not None else ()
    blocked = [t for t in terms if t.kind == "block" and _applies(t, "names")]
    if _term_hits(display_name, blocked):
        return True
    if live_names.is_offensive(display_name):
        return not _allowed(display_name, terms, "names")
    return False


def text_is_offensive(db: Session | None, text: str) -> bool:
    return bool(scan_text(db, {"text": text}))


def scan_text(db: Session | None, fields: dict[str, str]) -> list[Match]:
    """Content scan (RF-1112) of a few named fields; returns every match with an excerpt."""
    terms = admin_terms(db) if db is not None else ()
    blocked = [t for t in terms if t.kind == "block" and _applies(t, "content")]
    builtin = [Term(t, "substring", "block", "content") for t in live_names._BLOCK_SUBSTRINGS]  # noqa: SLF001
    builtin += [Term(t, "token", "block", "content") for t in _CONTENT_TOKENS]
    matches: list[Match] = []
    for field, text in fields.items():
        if not text:
            continue
        hits = _term_hits(text, blocked)
        builtin_hits = [h for h in _term_hits(text, builtin) if not _allowed(h, terms, "content")]
        for hit in dict.fromkeys(hits + builtin_hits):
            matches.append(Match(term=hit, field=field, excerpt=str(text)[:200]))
    return matches


def scan_snapshot(db: Session | None, snapshot: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Scan every text of a published version: prompts, options, answers, explanations."""
    findings: list[dict[str, Any]] = []
    for item in snapshot:
        fields = {"prompt": item.get("prompt") or "", "explanation": item.get("explanation") or ""}
        payload = item.get("payload") or {}
        for index, option in enumerate(payload.get("options") or []):
            fields[f"option_{index}"] = option.get("text") or ""
        if payload.get("body"):
            fields["body"] = payload.get("body") or ""
        for index, accepted in enumerate((item.get("answer") or {}).get("accepted_answers") or []):
            fields[f"accepted_{index}"] = accepted
        for match in scan_text(db, fields):
            findings.append({"position": item.get("position"), "field": match.field, "term": match.term, "excerpt": match.excerpt})
    return findings
