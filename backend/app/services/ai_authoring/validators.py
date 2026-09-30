"""Deterministic draft checks (contract §4). Each violation becomes an issue with severity."""
from __future__ import annotations

import re
from typing import Any

from app.services.live_items import normalize_text_answer

_ALL_NONE = re.compile(
    r"\b(todas|nenhuma) (as|das) (alternativas )?(anteriores|acima)\b|\b(all|none) of the (above|previous)\b", re.I
)
_NEGATIVE = re.compile(r"\b(não|nao|exceto|not|except|never|nunca)\b", re.I)
_NEGATIVE_UPPER = re.compile(r"\b(NÃO|NAO|EXCETO|NOT|EXCEPT)\b")
_OBSOLETE = re.compile(r"\b(SY0-(?:401|501|601)|CISSP 20(?:15|18)|CEH v(?:9|10|11)\b)", re.I)
_PT_WORDS = {"de", "que", "o", "a", "os", "as", "uma", "um", "qual", "quais", "para", "com", "não", "é", "do", "da", "em"}
_EN_WORDS = {"the", "which", "what", "of", "is", "a", "an", "to", "and", "for", "with", "not", "in", "does"}


def issue(code: str, severity: str, message: str, field: str | None = None) -> dict[str, Any]:
    return {"code": code, "severity": severity, "message": message, "field": field}


def detect_language(text: str) -> str | None:
    words = re.findall(r"[a-zà-ú]+", text.lower())
    pt = sum(1 for w in words if w in _PT_WORDS)
    en = sum(1 for w in words if w in _EN_WORDS)
    if pt + en < 3:
        return None
    return "pt-BR" if pt >= en else "en"


def check_draft(draft: dict[str, Any], *, language: str, allowed_domains: set[str] | None) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    item_type = draft["item_type"]
    options = draft.get("options") or []
    correct = [o for o in options if o.get("correct")]
    if item_type in {"single_choice", "true_false"} and len(correct) != 1:
        issues.append(issue("single_needs_one", "error", "Exactly one correct option is required.", "options"))
    if item_type == "multi_choice" and (len(correct) < 2 or len(correct) == len(options)):
        issues.append(issue("multi_needs_two", "error", "Multiple answer needs 2+ correct and 1+ wrong options.", "options"))
    if item_type == "type_answer" and not draft.get("accepted_answers"):
        issues.append(issue("schema_invalid", "error", "Typed answers need accepted answers.", "accepted_answers"))
    texts = [normalize_text_answer(o.get("text") or "") for o in options]
    if len(set(texts)) != len(texts):
        issues.append(issue("duplicate_option", "error", "Two options are the same.", "options"))
    haystack = " ".join([draft.get("prompt") or "", *[o.get("text") or "" for o in options]])
    if _ALL_NONE.search(haystack):
        issues.append(issue("all_none_of_above", "error", "'All/none of the above' is not allowed.", "options"))
    prompt = draft.get("prompt") or ""
    if _NEGATIVE.search(prompt) and not _NEGATIVE_UPPER.search(prompt):
        issues.append(issue("negative_stem", "warning", "Negative stem: write NÃO/NOT in capitals.", "prompt"))
    if item_type in {"single_choice", "multi_choice"} and correct and len(correct) < len(options):
        wrong = [o for o in options if not o.get("correct")]
        avg_wrong = sum(len(o["text"]) for o in wrong) / len(wrong)
        if any(len(o["text"]) > 1.5 * avg_wrong and len(o["text"]) - avg_wrong > 12 for o in correct):
            issues.append(issue("length_bias", "warning", "The correct option is much longer than the distractors.", "options"))
    if allowed_domains and draft.get("domain") and draft["domain"] not in allowed_domains:
        issues.append(issue("unknown_domain", "warning", "Domain is not in the certification blueprint.", "domain"))
    detected = detect_language(prompt)
    if detected and detected != language:
        issues.append(issue("language_mismatch", "warning", "The item is not in the requested language.", "prompt"))
    if _OBSOLETE.search(haystack + " " + (draft.get("explanation") or "")):
        issues.append(issue("obsolete_exam", "warning", "Mentions a retired exam version.", "prompt"))
    return issues


def batch_length_bias(drafts: list[dict[str, Any]]) -> None:
    """Warn when the correct option is the longest in more than 60% of the batch."""
    choice = [d for d in drafts if d["item_type"] in {"single_choice", "multi_choice"} and d.get("options")]
    if len(choice) < 4:
        return
    longest = 0
    for draft in choice:
        top = max(draft["options"], key=lambda o: len(o["text"]))
        longest += 1 if top.get("correct") else 0
    if longest / len(choice) > 0.6:
        for draft in choice:
            if not any(i["code"] == "length_bias" for i in draft["issues"]):
                draft["issues"].append(issue("length_bias", "warning", "Across the batch the correct option tends to be the longest.", "options"))
