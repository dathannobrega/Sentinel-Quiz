#!/usr/bin/env python3
"""Validate the question banks in questions/*.json (stdlib only; runs in CI).

Exit status: 1 when any ERROR is found, 0 otherwise (warnings never fail the run).

Question schema v3 (shared by cissp.json and securityplus.json)
----------------------------------------------------------------
Top level: {"exam": {...}, "questions": [...]}

exam keys: id, title, source, question_count (must equal len(questions)),
certification, language (null when the bank mixes languages), schema_version (3), notes.

Every question has ALL of these keys (optional ones are null, never omitted):

    id, question, language ("en" | "pt-BR"), multi_select, domain, difficulty,
    certification, tags, cross_domain_tags, question_type, cognitive_level,
    format_type, citations, source_materials, question_set, quality_score,
    source_exam_id, source_exam_title, legacy_source_file, options,
    correct_options, justification, needs_review, review_notes

Optional keys (may be omitted; not read by the ingest, editorial provenance only):

    explanation_source = who wrote `justification`:
                         "ai_draft" -> drafted by an AI content editor; the item MUST keep
                                       needs_review=true (and a review_notes entry) until an
                                       editor approves it, then becomes "editor".
                         "editor"   -> written or approved by a human editor.
                         "official" -> taken from the item's official source.
                         Omitted for legacy explanations of unknown provenance.

    Retiring an item: the ingest has no status/is_active field in the JSON. Removing a
    question from the file soft-deactivates it on the next import
    (deactivated_reason = removed_from_source; answer history is kept).

question_type vocabulary (normalized in schema v3):

    question_type   = response type, derived from the answer key:
                      "single_response"   -> exactly one correct option
                      "multiple_response" -> two or more correct options
    cognitive_level = former CISSP question_type values ("application" | "knowledge"),
                      null for banks that do not classify it.
    multi_select    = (len(correct_options) > 1), must agree with question_type.

    Legacy mapping applied to the data:
      CISSP  "application"       -> question_type=single_response,   cognitive_level=application
      CISSP  "knowledge"         -> question_type=single_response,   cognitive_level=knowledge
      Sec+   "single_response"   -> question_type=single_response   (unchanged)
      Sec+   "multiple_response" -> multiple_response when >1 correct, otherwise single_response
                                    (38 items had a single correct option)

Errors: invalid JSON/schema, missing keys, duplicate ids, answers not in options,
multi_select/question_type incoherence, invalid language/difficulty, domain outside
the official outline, exact duplicate questions, duplicate option texts (downgraded
to a warning when the item is flagged needs_review), invalid explanation_source or an
"ai_draft" explanation not flagged needs_review.

Warnings: missing written explanation, needs_review items, near-duplicate prompts
(same prompt, different options), unknown extra keys, domain distribution far from
the official blueprint weights.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FILES = [ROOT / "questions" / "cissp.json", ROOT / "questions" / "securityplus.json"]

QUESTION_KEYS = [
    "id", "question", "language", "multi_select", "domain", "difficulty", "certification",
    "tags", "cross_domain_tags", "question_type", "cognitive_level", "format_type", "citations",
    "source_materials", "question_set", "quality_score", "source_exam_id", "source_exam_title",
    "legacy_source_file", "options", "correct_options", "justification", "needs_review", "review_notes",
]
OPTIONAL_QUESTION_KEYS = ["explanation_source"]
EXPLANATION_SOURCES = {"ai_draft", "editor", "official"}
EXAM_KEYS = ["id", "title", "source", "question_count", "certification", "language", "schema_version", "notes"]

LANGUAGES = {"en", "pt-BR"}
DIFFICULTIES = {"Easy", "Medium", "Hard"}
QUESTION_TYPES = {"single_response", "multiple_response"}
COGNITIVE_LEVELS = {None, "application", "knowledge"}
FORMAT_TYPES = {None, "scenario_based", "direct"}

# Official exam outlines (percent of the exam per domain).
BLUEPRINTS = {
    "CISSP": {
        "Security and Risk Management": 16.0,
        "Asset Security": 10.0,
        "Security Architecture and Engineering": 13.0,
        "Communication and Network Security": 13.0,
        "Identity and Access Management (IAM)": 13.0,
        "Security Assessment and Testing": 12.0,
        "Security Operations": 13.0,
        "Software Development Security": 10.0,
    },
    "Security+": {
        "General Security Concepts": 12.0,
        "Threats, Vulnerabilities and Mitigations": 22.0,
        "Security Architecture": 18.0,
        "Security Operations": 28.0,
        "Security Program Management and Oversight": 20.0,
    },
}
# Warn when a domain's share of the bank deviates from its weight by more than this (p.p.).
DISTRIBUTION_TOLERANCE_PP = 8.0


def _norm(text) -> str:
    text = re.sub(r"\s+", " ", str(text or "").strip().lower())
    return re.sub(r"[\s.;:!?]+$", "", text)


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: dict[str, list[str]] = defaultdict(list)

    def error(self, where: str, message: str) -> None:
        self.errors.append(f"{where}: {message}")

    def warn(self, category: str, where: str, message: str = "") -> None:
        self.warnings[category].append(f"{where}{': ' + message if message else ''}")


def _check_cissp_domains_file(report: Report) -> None:
    path = ROOT / "material" / "cissp_domain.json"
    if not path.is_file():
        return
    try:
        names = {str(item.get("name")) for item in json.loads(path.read_text(encoding="utf-8")).get("domains", [])}
    except (ValueError, AttributeError) as exc:
        report.error(str(path.relative_to(ROOT)), f"invalid JSON: {exc}")
        return
    if names != set(BLUEPRINTS["CISSP"]):
        report.error(str(path.relative_to(ROOT)), "domain names differ from the CISSP blueprint used by the validator")


def validate_question(report: Report, where: str, q: dict, certification: str | None) -> None:
    missing = [key for key in QUESTION_KEYS if key not in q]
    if missing:
        report.error(where, f"missing keys {missing}")
    extra = [key for key in q if key not in QUESTION_KEYS and key not in OPTIONAL_QUESTION_KEYS]
    if extra:
        report.warn("unknown keys", where, str(extra))

    if not isinstance(q.get("id"), str) or not q["id"].strip():
        report.error(where, "id must be a non-empty string")
    if not isinstance(q.get("question"), str) or not q["question"].strip():
        report.error(where, "question must be a non-empty string")

    language = q.get("language")
    if language not in LANGUAGES:
        report.error(where, f"language must be one of {sorted(LANGUAGES)} (got {language!r})")

    if q.get("difficulty") not in DIFFICULTIES:
        report.error(where, f"difficulty must be one of {sorted(DIFFICULTIES)} (got {q.get('difficulty')!r})")

    q_cert = q.get("certification")
    if certification and q_cert != certification:
        report.error(where, f"certification {q_cert!r} differs from exam certification {certification!r}")
    blueprint = BLUEPRINTS.get(q_cert or certification or "")
    if blueprint is None:
        report.error(where, f"unknown certification {q_cert!r}")
    elif q.get("domain") not in blueprint:
        report.error(where, f"domain {q.get('domain')!r} is not an official {q_cert} domain")

    options = q.get("options")
    option_keys: list[str] = []
    if not isinstance(options, list) or len(options) < 2:
        report.error(where, "at least two options are required")
        options = options if isinstance(options, list) else []
    texts: list[str] = []
    for index, option in enumerate(options):
        if not isinstance(option, dict) or not str(option.get("key") or "").strip() or not str(option.get("text") or "").strip():
            report.error(where, f"option #{index} must have non-empty key and text")
            continue
        option_keys.append(str(option["key"]).strip())
        texts.append(_norm(option["text"]))
    if len(set(option_keys)) != len(option_keys):
        report.error(where, f"duplicate option keys {option_keys}")
    duplicated_texts = [text for text, count in Counter(texts).items() if count > 1]
    if duplicated_texts:
        if q.get("needs_review"):
            report.warn("duplicate option texts (flagged needs_review)", where, str(duplicated_texts))
        else:
            report.error(where, f"options with identical text {duplicated_texts} (fix or flag needs_review)")

    correct = q.get("correct_options")
    if not isinstance(correct, list) or not correct:
        report.error(where, "correct_options must be a non-empty list")
        correct = []
    not_in_options = [key for key in correct if key not in option_keys]
    if not_in_options:
        report.error(where, f"correct_options {not_in_options} not among option keys {option_keys}")
    if len(set(correct)) != len(correct):
        report.error(where, f"duplicate correct_options {correct}")

    is_multi = len(set(correct)) > 1
    if q.get("multi_select") is not is_multi:
        report.error(where, f"multi_select={q.get('multi_select')!r} but {len(set(correct))} correct option(s)")
    expected_type = "multiple_response" if is_multi else "single_response"
    if q.get("question_type") not in QUESTION_TYPES:
        report.error(where, f"question_type must be one of {sorted(QUESTION_TYPES)} (got {q.get('question_type')!r})")
    elif q.get("question_type") != expected_type:
        report.error(where, f"question_type={q.get('question_type')!r} but expected {expected_type!r}")
    if q.get("cognitive_level") not in COGNITIVE_LEVELS:
        report.error(where, f"invalid cognitive_level {q.get('cognitive_level')!r}")
    if q.get("format_type") not in FORMAT_TYPES:
        report.error(where, f"invalid format_type {q.get('format_type')!r}")
    if not isinstance(q.get("needs_review"), bool):
        report.error(where, "needs_review must be a boolean")
    for key in ("tags", "cross_domain_tags", "citations", "source_materials"):
        if key in q and not isinstance(q[key], list):
            report.error(where, f"{key} must be a list")

    if not str(q.get("justification") or "").strip():
        report.warn("missing explanation", where)
    if "explanation_source" in q:
        source = q["explanation_source"]
        if source not in EXPLANATION_SOURCES:
            report.error(where, f"explanation_source must be one of {sorted(EXPLANATION_SOURCES)} (got {source!r})")
        elif source == "ai_draft" and not (q.get("needs_review") and str(q.get("review_notes") or "").strip()):
            report.error(where, "explanation_source='ai_draft' requires needs_review=true and review_notes until an editor approves it")
    if q.get("needs_review"):
        report.warn("needs_review", where, str(q.get("review_notes") or ""))


def validate_file(report: Report, path: Path, seen_ids: dict[str, str]) -> None:
    label = path.name
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        report.error(label, f"cannot read JSON: {exc}")
        return
    if not isinstance(data, dict) or set(data) != {"exam", "questions"}:
        report.error(label, "top level must be an object with exactly 'exam' and 'questions'")
        return
    exam = data.get("exam")
    questions = data.get("questions")
    if not isinstance(exam, dict) or not isinstance(questions, list):
        report.error(label, "'exam' must be an object and 'questions' a list")
        return

    missing = [key for key in EXAM_KEYS if key not in exam]
    if missing:
        report.error(f"{label}:exam", f"missing keys {missing}")
    if exam.get("schema_version") != 3:
        report.error(f"{label}:exam", f"schema_version must be 3 (got {exam.get('schema_version')!r})")
    if exam.get("question_count") != len(questions):
        report.error(f"{label}:exam", f"question_count={exam.get('question_count')!r} but file has {len(questions)} questions")
    certification = exam.get("certification")
    if certification not in BLUEPRINTS:
        report.error(f"{label}:exam", f"unknown certification {certification!r}")
    if exam.get("language") is not None and exam.get("language") not in LANGUAGES:
        report.error(f"{label}:exam", f"invalid language {exam.get('language')!r}")

    fingerprints: dict[tuple, str] = {}
    prompts: dict[str, list[str]] = defaultdict(list)
    domain_counts: Counter[str] = Counter()
    for index, q in enumerate(questions):
        if not isinstance(q, dict):
            report.error(f"{label}#{index}", "question must be an object")
            continue
        qid = str(q.get("id") or f"#{index}")
        where = f"{label}:{qid}"
        validate_question(report, where, q, certification)
        if qid in seen_ids:
            report.error(where, f"duplicate id (also in {seen_ids[qid]})")
        seen_ids[qid] = label
        if exam.get("language") is not None and q.get("language") != exam.get("language"):
            report.error(where, f"language {q.get('language')!r} differs from exam language {exam.get('language')!r}")

        options = [o for o in (q.get("options") or []) if isinstance(o, dict)]
        texts = {str(o.get("key")): _norm(o.get("text")) for o in options}
        correct = frozenset(texts.get(str(k), "") for k in (q.get("correct_options") or []))
        fingerprint = (_norm(q.get("question")), frozenset(texts.values()), correct)
        if fingerprint in fingerprints:
            report.error(where, f"exact duplicate of {fingerprints[fingerprint]} (same prompt, options and answer)")
        else:
            fingerprints[fingerprint] = qid
        prompts[_norm(q.get("question"))].append(qid)
        domain_counts[str(q.get("domain"))] += 1

    for ids in prompts.values():
        if len(ids) > 1:
            report.warn("near-duplicate prompts (same prompt, different options)", f"{label}", ", ".join(ids))

    blueprint = BLUEPRINTS.get(certification or "")
    total = sum(domain_counts.values())
    if blueprint and total:
        for domain, weight in blueprint.items():
            share = 100.0 * domain_counts.get(domain, 0) / total
            if abs(share - weight) > DISTRIBUTION_TOLERANCE_PP:
                report.warn(
                    "domain distribution vs blueprint",
                    f"{label}:{domain}",
                    f"{domain_counts.get(domain, 0)} questions = {share:.1f}% of the bank (official weight {weight:g}%)",
                )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="*", type=Path, help="JSON files (default: questions/cissp.json questions/securityplus.json)")
    parser.add_argument("--verbose", "-v", action="store_true", help="print every warning (default: 10 per category)")
    args = parser.parse_args(argv)

    files = args.files or DEFAULT_FILES
    report = Report()
    _check_cissp_domains_file(report)
    seen_ids: dict[str, str] = {}
    for path in files:
        validate_file(report, path, seen_ids)

    for category, items in sorted(report.warnings.items()):
        print(f"WARNING [{category}]: {len(items)}")
        shown = items if args.verbose else items[:10]
        for item in shown:
            print(f"  - {item}")
        if len(shown) < len(items):
            print(f"  ... {len(items) - len(shown)} more (use --verbose)")
    for item in report.errors:
        print(f"ERROR: {item}")
    total_warnings = sum(len(items) for items in report.warnings.values())
    print(f"\nChecked {len(files)} file(s): {len(report.errors)} error(s), {total_warnings} warning(s).")
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
