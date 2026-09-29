"""Pipeline steps: fetch (pinned clone into a cache OUTSIDE the repo), extract, validate,
dedupe, review-apply and import."""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

from . import adapters
from .registry import REPO_ROOT, check_import_allowed

QUESTIONS_DIR = REPO_ROOT / "questions"
IMPORTS_DIR = QUESTIONS_DIR / "imports"
DEFAULT_CACHE = Path.home() / ".cache" / "sentinel-quiz" / "sources"
FUZZY_THRESHOLD = 0.9
REVIEW_VERDICTS = ("correct", "incorrect_key", "ambiguous", "outdated", "off_topic", "poor_quality")
DROP_VERDICTS = {"ambiguous", "outdated", "off_topic", "poor_quality"}


class PipelineError(Exception):
    pass


# --------------------------------------------------------------------------- cache / fetch

def cache_root() -> Path:
    root = Path(os.environ.get("SQ_SOURCES_CACHE") or DEFAULT_CACHE).expanduser().resolve()
    try:
        root.relative_to(REPO_ROOT.resolve())
    except ValueError:
        return root
    raise PipelineError(f"the source cache must live outside the repository (got {root})")


def checkout_dir(source: dict[str, Any]) -> Path:
    return cache_root() / source["id"] / "checkout"


def work_file(source: dict[str, Any], name: str) -> Path:
    return cache_root() / source["id"] / name


def fetch(source: dict[str, Any], *, runner=subprocess.run) -> Path:
    """Clone the source into the cache and check out the pinned commit (idempotent)."""
    target = checkout_dir(source)
    if not (target / ".git").is_dir():
        target.parent.mkdir(parents=True, exist_ok=True)
        runner(["git", "clone", "--quiet", "--no-checkout", source["url"], str(target)], check=True)
    runner(["git", "-C", str(target), "fetch", "--quiet", "origin", source["commit"]], check=False)
    runner(["git", "-C", str(target), "checkout", "--quiet", "--detach", source["commit"]], check=True)
    return target


# --------------------------------------------------------------------------- files

def exam_block(source: dict[str, Any], count: int) -> dict[str, Any]:
    return {
        "id": source.get("exam_id") or f"external_{source['id_prefix']}",
        "title": f"Importação externa - {source['name']}",
        "source": source["url"],
        "question_count": count,
        "certification": source.get("certification"),
        "language": source.get("language") or "en",
        "schema_version": 3,
        "notes": (
            f"Third-party questions from {source['url']} @ {source['commit']} (license: {source['license']}, "
            f"registry status: {source['status']}). Every item needs SME review (needs_review=true)."
        ),
    }


def write_bank(path: Path, source: dict[str, Any], questions: list[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"exam": exam_block(source, len(questions)), "questions": questions}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return path


def read_bank(path: Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
        raise PipelineError(f"{path}: expected {{'exam': ..., 'questions': [...]}}")
    return data


def extract_to_cache(source: dict[str, Any], root: Path | None = None) -> tuple[Path, dict]:
    checkout = Path(root) if root else checkout_dir(source)
    if not checkout.is_dir():
        raise PipelineError(f"{checkout} does not exist: run `fetch {source['id']}` first")
    questions, stats = adapters.extract(source, checkout)
    return write_bank(work_file(source, "extracted.json"), source, questions), stats


# --------------------------------------------------------------------------- validate

def _load_validator():
    script = REPO_ROOT / "scripts" / "validate_content.py"
    spec = importlib.util.spec_from_file_location("sq_validate_content", script)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def validate(path: Path, *, require_provenance: bool = True) -> tuple[list[str], dict[str, list[str]]]:
    """(errors, warnings) of a normalized file (schema v3 + provenance on every item)."""
    validator = _load_validator()
    report = validator.Report()
    validator.validate_file(report, Path(path), {})
    errors = list(report.errors)
    if require_provenance:
        for index, q in enumerate(read_bank(path)["questions"]):
            missing = [key for key in validator.PROVENANCE_KEYS if not str(q.get(key) or "").strip()]
            if missing:
                errors.append(f"{q.get('id') or index}: missing provenance {missing}")
    return errors, dict(report.warnings)


# --------------------------------------------------------------------------- dedupe

def normalize_prompt(text: Any) -> str:
    value = str(text or "").lower().replace("’", "'").replace("“", '"').replace("”", '"')
    value = re.sub(r"[^a-z0-9à-ÿ ]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def similarity(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if not a or not b or min(len(a), len(b)) / max(len(a), len(b)) < FUZZY_THRESHOLD:
        return 0.0
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    if matcher.real_quick_ratio() < FUZZY_THRESHOLD or matcher.quick_ratio() < FUZZY_THRESHOLD:
        return 0.0
    return matcher.ratio()


def repository_banks(exclude: Iterable[Path] = ()) -> list[Path]:
    excluded = {Path(p).resolve() for p in exclude}
    files = sorted(QUESTIONS_DIR.glob("*.json")) + (sorted(IMPORTS_DIR.glob("*.json")) if IMPORTS_DIR.is_dir() else [])
    return [path for path in files if path.resolve() not in excluded]


def dedupe(path: Path, *, against: Iterable[Path] | None = None, threshold: float = FUZZY_THRESHOLD) -> dict[str, Any]:
    """Duplicates of each candidate against the banks (exact + difflib >= threshold) and inside the file."""
    candidates = read_bank(path)["questions"]
    banks = list(against) if against is not None else repository_banks(exclude=[path])
    existing: list[tuple[str, str, str]] = []
    for bank in banks:
        for q in read_bank(bank)["questions"]:
            prompt = q.get("question") or q.get("title")
            existing.append((bank.name, str(q.get("id")), normalize_prompt(prompt)))
    exact_index = {prompt: (bank, qid) for bank, qid, prompt in existing}
    matches: list[dict[str, Any]] = []
    seen_in_file: dict[str, str] = {}
    for q in candidates:
        prompt = normalize_prompt(q.get("question"))
        qid = str(q.get("id"))
        if prompt in seen_in_file:
            matches.append({"id": qid, "match": seen_in_file[prompt], "bank": "(same file)", "ratio": 1.0, "exact": True})
            continue
        seen_in_file[prompt] = qid
        if prompt in exact_index:
            bank, other = exact_index[prompt]
            matches.append({"id": qid, "match": other, "bank": bank, "ratio": 1.0, "exact": True})
            continue
        for bank, other, other_prompt in existing:
            ratio = similarity(prompt, other_prompt)
            if ratio >= threshold:
                matches.append({"id": qid, "match": other, "bank": bank, "ratio": round(ratio, 3), "exact": False})
                break
    return {
        "file": str(path),
        "threshold": threshold,
        "candidates": len(candidates),
        "duplicates": len({m["id"] for m in matches}),
        "matches": matches,
    }


# --------------------------------------------------------------------------- review-apply

def _review_items(review: Any) -> list[dict[str, Any]]:
    if isinstance(review, dict):
        review = review.get("items") or review.get("reviews") or []
    return [item for item in review if isinstance(item, dict) and item.get("id")]


def apply_review(
    path: Path,
    review_path: Path,
    *,
    out: Path | None = None,
    keep_flagged: bool = False,
    drop_unreviewed: bool = False,
) -> dict[str, Any]:
    """Merge SME review verdicts into a normalized file.

    Review items (REVIEW_INSTRUCTIONS format): id, verdict, correct_options, reasoning,
    realism, objective, domain, difficulty, explanation_ok, explanation_issue,
    ai_explanation. ``incorrect_key`` fixes the key; ambiguous/outdated/off_topic/
    poor_quality items are dropped unless ``keep_flagged``. Items keep
    ``needs_review = true`` (an editor still approves them in the admin).
    """
    bank = read_bank(path)
    reviews = {str(item["id"]): item for item in _review_items(json.loads(Path(review_path).read_text(encoding="utf-8")))}
    kept: list[dict] = []
    stats = {"reviewed": 0, "unreviewed": 0, "key_fixed": 0, "dropped": 0, "ai_explanations": 0, "verdicts": {}}
    for q in bank["questions"]:
        review = reviews.get(str(q.get("id")))
        if review is None:
            stats["unreviewed"] += 1
            if not drop_unreviewed:
                kept.append(q)
            continue
        stats["reviewed"] += 1
        verdict = str(review.get("verdict") or "").strip()
        if verdict not in REVIEW_VERDICTS:
            raise PipelineError(f"{q.get('id')}: unknown verdict {verdict!r}")
        stats["verdicts"][verdict] = stats["verdicts"].get(verdict, 0) + 1
        if verdict in DROP_VERDICTS and not keep_flagged:
            stats["dropped"] += 1
            continue
        notes = [q.get("review_notes")] if q.get("review_notes") else []
        reason = review.get("reasoning") or review.get("reason")
        notes.append(f"SME review: {verdict}" + (f" - {reason}" if reason else ""))
        option_keys = {str(o.get("key")) for o in q.get("options") or []}
        proposed = [str(k).strip().upper() for k in review.get("correct_options") or [] if str(k).strip()]
        if verdict == "incorrect_key":
            if not proposed or any(k not in option_keys for k in proposed):
                raise PipelineError(f"{q.get('id')}: incorrect_key review without a valid correct_options")
            q["correct_options"] = sorted(set(proposed))
            stats["key_fixed"] += 1
        multi = len(set(q.get("correct_options") or [])) > 1
        q["multi_select"] = multi
        q["question_type"] = "multiple_response" if multi else "single_response"
        domain = review.get("domain") or review.get("correct_domain")
        if domain:
            q["domain"] = domain
        if review.get("difficulty"):
            q["difficulty"] = review["difficulty"]
        if review.get("objective"):
            tags = [t for t in q.get("tags") or [] if not str(t).startswith("obj ")]
            q["tags"] = tags + [f"obj {review['objective']}"]
        if review.get("realism") is not None:
            q["quality_score"] = float(review["realism"]) * 20.0
        explanation_ok = review.get("explanation_ok")
        if review.get("ai_explanation") and (explanation_ok is False or verdict == "incorrect_key"):
            q["justification"] = str(review["ai_explanation"]).strip()
            q["explanation_source"] = "ai_draft"
            stats["ai_explanations"] += 1
            notes.append("AI-drafted explanation pending editor approval")
        elif explanation_ok is False and review.get("explanation_issue"):
            notes.append(f"explanation issue: {review['explanation_issue']}")
        q["needs_review"] = True
        q["review_notes"] = "; ".join(str(n) for n in notes if n) or None
        kept.append(q)
    bank["questions"] = kept
    bank.setdefault("exam", {})["question_count"] = len(kept)
    target = Path(out) if out else Path(path)
    target.write_text(json.dumps(bank, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    stats["kept"] = len(kept)
    stats["output"] = str(target)
    return stats


# --------------------------------------------------------------------------- import

def import_source(
    source: dict[str, Any],
    input_path: Path,
    *,
    imports_dir: Path | None = None,
    against: Iterable[Path] | None = None,
) -> dict[str, Any]:
    """Write questions/imports/<id>.json (license gate, validation and dedupe first)."""
    check_import_allowed(source)
    bank = read_bank(input_path)
    dedupe_report = dedupe(Path(input_path), against=against)
    duplicate_ids = {match["id"] for match in dedupe_report["matches"]}
    questions = []
    for q in bank["questions"]:
        if str(q.get("id")) in duplicate_ids:
            continue
        q["needs_review"] = True
        q["source_repo"] = q.get("source_repo") or source["url"]
        q["source_commit"] = q.get("source_commit") or source["commit"]
        q["source_license"] = source["license"]
        questions.append(q)
    target_dir = Path(imports_dir) if imports_dir else IMPORTS_DIR
    target = target_dir / f"{source['id']}.json"
    staged = target.with_suffix(".json.tmp")
    write_bank(staged, source, questions)
    try:
        errors, _warnings = validate(staged)
        if errors:
            raise PipelineError(f"{len(errors)} validation error(s), nothing imported: " + "; ".join(errors[:5]))
        staged.replace(target)
    finally:
        if staged.exists():
            staged.unlink()
    return {"output": str(target), "imported": len(questions), "skipped_duplicates": len(duplicate_ids)}
