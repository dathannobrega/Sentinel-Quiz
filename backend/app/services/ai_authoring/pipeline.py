"""Generation and improvement pipelines (PLANO §12.4).

These functions never hold a database connection while the model is thinking
(M-B5): they receive plain inputs, call the provider, and use short sessions only for
the dedupe corpus. ``StageCallback`` reports progress to the job row.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from pydantic import ValidationError
from sqlalchemy import select

from app.core.config import settings
from app.live.db import live_db
from app.models import DomainBlueprint
from app.services.ai_authoring import dedupe, prompts, validators
from app.services.ai_authoring.guards import clean_user_text, injection_suspected
from app.services.ai_authoring.provider import LLMProvider, Usage
from app.services.ai_authoring.schemas import LlmCritic, LlmItem, LlmItems, LlmProposal
from app.services.ai_authoring.suggest import suggest_time_limit
from app.services.live_items import OPTION_MAX, PROMPT_MAX, normalize_text_answer

logger = logging.getLogger("app.ai_authoring.pipeline")

StageCallback = Callable[[str], None]
KEYS = "ABCDEF"
_TRUE_WORDS = {"verdadeiro", "true", "v", "certo", "correto"}


@dataclass
class PipelineResult:
    output: dict[str, Any]
    usage: Usage = field(default_factory=Usage)
    produced: int = 0
    injection: bool = False
    prompt_id: str | None = None


def blueprint_domains(certification: str | None) -> set[str] | None:
    if not certification:
        return None
    with live_db() as db:
        rows = db.execute(
            select(DomainBlueprint.domain).where(
                DomainBlueprint.certification == certification, DomainBlueprint.weight.is_not(None)
            )
        ).scalars()
        domains = {row for row in rows if row}
    return domains or None


def _add(usage: Usage, extra: Usage) -> None:
    usage.tokens_in += extra.tokens_in
    usage.tokens_out += extra.tokens_out


# ----------------------------------------------------------------------------- drafts

def _to_draft(index: int, item: LlmItem, request: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    item_type = item.type
    by_key = {o.key.upper(): o for o in item.options}
    correct_raw = {k.upper() for k in item.correct_keys}
    options: list[dict[str, Any]] = []
    if item_type == "true_false":
        ordered = sorted(item.options, key=lambda o: 0 if normalize_text_answer(o.text) in _TRUE_WORDS else 1)[:2]
        if len(ordered) != 2:
            issues.append(validators.issue("schema_invalid", "error", "True/false needs two options.", "options"))
        for key, option in zip(("T", "F"), ordered):
            options.append({"key": key, "text": option.text.strip(), "correct": option.key.upper() in correct_raw, "why_wrong": option.why_wrong})
    elif item_type != "type_answer":
        for key, raw_key in zip(KEYS, sorted(by_key)):
            option = by_key[raw_key]
            options.append({"key": key, "text": option.text.strip(), "correct": raw_key in correct_raw, "why_wrong": (option.why_wrong or None) if raw_key not in correct_raw else None})
        if len(options) < 2:
            issues.append(validators.issue("schema_invalid", "error", "At least two options are required.", "options"))
        if correct_raw - set(by_key):
            issues.append(validators.issue("schema_invalid", "error", "A correct key does not match any option.", "options"))
    if len(item.prompt) > PROMPT_MAX:
        issues.append(validators.issue("schema_invalid", "error", f"Prompt longer than {PROMPT_MAX} characters.", "prompt"))
    if any(len(o["text"]) > OPTION_MAX for o in options):
        issues.append(validators.issue("schema_invalid", "error", f"Option longer than {OPTION_MAX} characters.", "options"))
    accepted = []
    for value in item.accepted_answers:
        text = str(value or "").strip()[:60]
        if text and normalize_text_answer(text) not in {normalize_text_answer(a) for a in accepted}:
            accepted.append(text)
    limit = item.time_limit_s
    if not limit or not 10 <= limit <= 120:
        limit, _ = suggest_time_limit(item_type, item.prompt, [o["text"] for o in options])
    return {
        "index": index,
        "item_type": item_type,
        "prompt": item.prompt.strip(),
        "options": options,
        "accepted_answers": accepted[:10] if item_type == "type_answer" else [],
        "explanation": (item.rationale or "").strip(),
        "time_limit_s": int(limit),
        "difficulty": item.difficulty,
        "domain": item.domain or None,
        "certification": request.get("certification"),
        "issues": issues,
        "critic": None,
        "applied": False,
        "blocked": False,
    }


def _run_critic(provider: LLMProvider, drafts: list[dict[str, Any]], *, language: str, usage: Usage) -> None:
    candidates = [d for d in drafts if d["item_type"] != "type_answer" and d["options"] and not d["blocked"]]
    if not candidates or not settings.ai_critic_enabled:
        return
    blind = [
        {"index": d["index"], "type": d["item_type"], "prompt": d["prompt"], "options": [{"key": o["key"], "text": o["text"]} for o in d["options"]]}
        for d in candidates
    ]
    system, user = prompts.critic(blind, language=language)
    try:
        raw, extra = provider.generate_json("critic", system, user, model=settings.effective_ai_critic_model())
        _add(usage, extra)
        verdict = LlmCritic.model_validate(raw)
    except Exception:  # the critic is advisory: never lose the drafts because of it
        logger.warning("AI critic failed", extra={"event": "ai_critic_failed"}, exc_info=True)
        return
    by_index = {d["index"]: d for d in candidates}
    for answer in verdict.answers:
        draft = by_index.get(answer.index)
        if draft is None:
            continue
        correct = sorted(o["key"] for o in draft["options"] if o["correct"])
        solved = sorted({k.upper() for k in answer.solved_keys})
        defensible = {k.upper() for k in answer.defensible_keys} or set(solved)
        flags = []
        if solved != correct:
            flags.append("key_mismatch")
        if answer.confidence < 0.7 or (draft["item_type"] != "multi_choice" and len(defensible) > 1):
            flags.append("ambiguous")
        if answer.factual_issues:
            flags.append("factual_issue")
        draft["critic"] = {"solved_keys": solved, "confidence": round(answer.confidence, 2), "flags": flags, "notes": answer.factual_issues[:5]}
        messages = {
            "key_mismatch": "The independent reviewer chose a different answer; confirm the key.",
            "ambiguous": "The item may have more than one defensible answer.",
            "factual_issue": "The reviewer questioned a fact in this item.",
        }
        for flag in flags:
            draft["issues"].append(validators.issue(flag, "warning", messages[flag], "options"))


def generate(
    provider: LLMProvider,
    request: dict[str, Any],
    *,
    topic: str | None,
    source_text: str | None,
    stage: StageCallback,
) -> PipelineResult:
    usage = Usage()
    topic = clean_user_text(topic, limit=500) if topic else None
    source = clean_user_text(source_text, limit=20000) if source_text else None
    if request.get("audience_note"):
        request = {**request, "audience_note": clean_user_text(request["audience_note"], limit=200)}
    injection = injection_suspected(" ".join(filter(None, [topic, source, request.get("audience_note")])))
    stage("generating")
    system, user = prompts.generation(request, topic=topic, source_text=source)
    raw, extra = provider.generate_json("generate", system, user, model=settings.effective_ai_model())
    _add(usage, extra)

    stage("validating")
    raw_items = LlmItems.model_validate(raw).items[: int(request["n"])]
    drafts: list[dict[str, Any]] = []
    invalid = 0
    for raw_item in raw_items:
        try:
            item = LlmItem.model_validate(raw_item)
        except ValidationError:
            invalid += 1
            continue
        if item.type not in request["types"]:
            invalid += 1
            continue
        drafts.append(_to_draft(len(drafts), item, request))
    allowed = blueprint_domains(request.get("certification"))
    for draft in drafts:
        draft["issues"].extend(validators.check_draft(draft, language=request["language"], allowed_domains=allowed))
    validators.batch_length_bias(drafts)
    for index in dedupe.batch_duplicates([d["prompt"] for d in drafts]):
        drafts[index]["issues"].append(validators.issue("duplicate_batch", "error", "Duplicates another draft of this batch.", "prompt"))
    with live_db() as db:
        matches = dedupe.bank_matches(db, [d["prompt"] for d in drafts], certification=request.get("certification"))
    for draft, match in zip(drafts, matches):
        if match:
            draft["issues"].append(
                validators.issue("duplicate_bank", "warning", f"Very similar to a bank question ({int(match[1] * 100)}%).", "prompt")
            )
    for draft in drafts:
        draft["blocked"] = any(i["severity"] == "error" for i in draft["issues"])

    stage("critic")
    _run_critic(provider, drafts, language=request["language"], usage=usage)
    output = {
        "type": "drafts",
        "items": drafts,
        "summary": {
            "requested": int(request["n"]),
            "produced": len(drafts),
            "blocked": sum(1 for d in drafts if d["blocked"]),
            "warnings": sum(1 for d in drafts for i in d["issues"] if i["severity"] == "warning"),
            "discarded_invalid": invalid,
        },
    }
    return PipelineResult(output=output, usage=usage, produced=len(drafts), injection=injection, prompt_id=prompts.GEN_PROMPT_ID)


# ----------------------------------------------------------------------------- improvement

def improve(
    provider: LLMProvider,
    *,
    action: str,
    item: dict[str, Any],
    instructions: str | None,
    language: str,
    stage: StageCallback,
) -> PipelineResult:
    usage = Usage()
    instructions = clean_user_text(instructions, limit=300) if instructions else None
    stage("generating")
    system, user = prompts.improve(action, item, instructions=instructions, language=language)
    raw, extra = provider.generate_json("improve", system, user, model=settings.effective_ai_model())
    _add(usage, extra)
    stage("validating")
    proposal = LlmProposal.model_validate(raw)
    result: dict[str, Any] = {"changed": []}
    current = {o["key"]: o for o in item.get("options") or []}
    if action in {"rewrite", "distractors"} and proposal.options:
        options = []
        for option in proposal.options:
            key = option.key.upper()
            if key not in current:
                continue
            keep_correct = action == "distractors" and current[key]["correct"]
            text = current[key]["text"] if keep_correct else option.text.strip()[:OPTION_MAX]
            options.append({"key": key, "text": text, "correct": current[key]["correct"]})
        missing = [o for key, o in current.items() if key not in {x["key"] for x in options}]
        options.extend({"key": o["key"], "text": o["text"], "correct": o["correct"]} for o in missing)
        options.sort(key=lambda o: o["key"])
        if [o["text"] for o in options] != [current[k]["text"] for k in sorted(current)]:
            result["options"] = options
            result["changed"].append("options")
    if action == "rewrite" and proposal.prompt and proposal.prompt.strip() != (item.get("prompt") or "").strip():
        result["prompt"] = proposal.prompt.strip()[:PROMPT_MAX]
        result["changed"].append("prompt")
    if action == "explain" and proposal.explanation:
        result["explanation"] = proposal.explanation.strip()[:2000]
        result["changed"].append("explanation")
    stage("done")
    return PipelineResult(
        output={"type": "improvement", "item_id": item.get("id"), "proposal": result},
        usage=usage,
        produced=1 if result["changed"] else 0,
        injection=injection_suspected(instructions or ""),
        prompt_id=prompts.IMPROVE_PROMPT_ID,
    )
