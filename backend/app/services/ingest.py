from __future__ import annotations

import json
import os
import hashlib
import re
from sqlalchemy.orm import Session
from sqlalchemy import func, select
from app.models import Exam, Question, Option, Explanation, ImportState


SECURITY_PLUS_DOMAIN_KEYWORDS = {
    "Threats, Vulnerabilities and Mitigations": [
        "phishing", "whaling", "smishing", "vishing", "malware", "ransomware", "trojan",
        "vulnerability", "exploit", "attack", "threat actor", "social engineering",
        "mitigation", "injection", "pentest", "reconnaissance", "spoofing", "detection",
    ],
    "Security Architecture": [
        "firewall", "ngfw", "waf", "vpn", "nac", "802.1x", "load balancer", "virtualization",
        "segmentation", "zero trust", "proxy", "hsm", "cloud", "architecture", "network",
        "dmz", "sase", "secure design", "microsegmentation", "wireless",
    ],
    "Security Operations": [
        "incident", "forensic", "siem", "logging", "log review", "monitoring", "backup",
        "recovery", "disaster", "patch", "hardening", "operations", "playbook",
        "containment", "eradication", "mttr", "change management", "rollback",
    ],
    "Security Program Management and Oversight": [
        "policy", "governance", "risk", "compliance", "privacy", "audit", "training",
        "awareness", "vendor", "third-party", "procedure", "legal", "regulation",
        "data retention", "classification", "control owner", "program",
    ],
    "General Security Concepts": [
        "cia", "aaa", "authentication", "authorization", "accounting", "hashing",
        "encryption", "certificate", "access control", "least privilege", "non-repudiation",
        "integrity", "availability", "confidentiality",
    ],
}


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return cleaned or "exam"


def _option_key_from_index(index: int) -> str:
    if index < 0:
        return ""
    chars: list[str] = []
    value = index
    while True:
        value, remainder = divmod(value, 26)
        chars.append(chr(65 + remainder))
        if value == 0:
            break
        value -= 1
    return "".join(reversed(chars))


def _normalize_tags(raw_tags) -> list[str]:
    if not raw_tags:
        return []
    if isinstance(raw_tags, str):
        raw_tags = [raw_tags]
    if not isinstance(raw_tags, list):
        return []

    seen = set()
    normalized: list[str] = []
    for item in raw_tags:
        text = str(item or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return normalized


def _normalize_citations(raw_citations) -> list[dict]:
    if not raw_citations:
        return []
    if not isinstance(raw_citations, list):
        return []

    normalized: list[dict] = []
    seen = set()
    for item in raw_citations:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "").strip()
        reference = str(item.get("reference") or "").strip()
        if not source and not reference:
            continue
        key = (source.lower(), reference.lower())
        if key in seen:
            continue
        seen.add(key)
        normalized.append({"source": source, "reference": reference})
    return normalized


def _detect_certification(*values: str | None) -> str | None:
    haystack = " ".join([str(v or "") for v in values]).lower()
    if "security+" in haystack or "security plus" in haystack:
        return "Security+"
    if "cissp" in haystack:
        return "CISSP"
    if "ccsp" in haystack:
        return "CCSP"
    return None


def _infer_security_plus_domain(question_text: str, options: list[dict], justification: str | None) -> str:
    corpus = " ".join([
        question_text or "",
        " ".join([opt.get("text", "") for opt in options]),
        justification or "",
    ]).lower()

    best_domain = "General Security Concepts"
    best_score = 0
    for domain, keywords in SECURITY_PLUS_DOMAIN_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in corpus)
        if score > best_score:
            best_domain = domain
            best_score = score
    return best_domain


def _normalize_options(raw_options) -> list[dict]:
    if not isinstance(raw_options, list):
        return []

    normalized: list[dict] = []
    for index, raw in enumerate(raw_options):
        if isinstance(raw, dict):
            key = str(raw.get("key") or _option_key_from_index(index)).strip().upper()
            text = str(raw.get("text") or "").strip()
        else:
            key = _option_key_from_index(index)
            text = str(raw or "").strip()
        if not key or not text:
            continue
        normalized.append({"key": key, "text": text})
    return normalized


def _normalize_correct_keys(raw_question: dict, options: list[dict]) -> list[str]:
    option_keys = [opt["key"] for opt in options]
    option_key_set = set(option_keys)
    resolved: list[str] = []

    def add_key(value) -> None:
        if isinstance(value, int):
            if 0 <= value < len(option_keys):
                resolved.append(option_keys[value])
            return

        text = str(value or "").strip().upper()
        if not text:
            return
        if text in option_key_set:
            resolved.append(text)
            return
        if text.isdigit():
            add_key(int(text))

    if isinstance(raw_question.get("correct_options"), list):
        for item in raw_question.get("correct_options") or []:
            add_key(item)
    else:
        answer = raw_question.get("correct_answer")
        if isinstance(answer, list):
            for item in answer:
                add_key(item)
        else:
            add_key(answer)

    deduped: list[str] = []
    seen = set()
    for key in resolved:
        if key in seen:
            continue
        seen.add(key)
        deduped.append(key)
    return deduped


def _normalize_wrapped_payload(file_name: str, payload: dict) -> list[dict]:
    exam = payload.get("exam") or {}
    questions = payload.get("questions") or []
    if not isinstance(questions, list):
        raise ValueError("Invalid questions payload")

    stem = os.path.splitext(file_name)[0]
    exam_id = str(exam.get("id") or _slugify(stem)).strip()
    title = str(exam.get("title") or exam_id or stem).strip()
    source = exam.get("source")
    default_certification = _detect_certification(title, source, file_name)

    normalized_questions: list[dict] = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        qid = str(q.get("id") or "").strip()
        prompt = str(q.get("question") or "").strip()
        if not qid or not prompt:
            continue

        options = _normalize_options(q.get("options"))
        correct_options = _normalize_correct_keys(q, options)
        if not options or not correct_options:
            continue

        justification = q.get("justification") or q.get("explanation")
        certification = q.get("certification") or default_certification
        domain = q.get("domain") or q.get("topic")
        if not domain and certification == "Security+":
            domain = _infer_security_plus_domain(prompt, options, justification)

        tags = _normalize_tags(q.get("tags"))
        normalized_questions.append({
            "id": qid,
            "question": prompt,
            "multi_select": bool(q.get("multi_select", False) or len(correct_options) > 1),
            "options": options,
            "correct_options": correct_options,
            "justification": justification,
            "domain": domain,
            "difficulty": q.get("difficulty"),
            "certification": certification,
            "tags": tags,
            "citations": _normalize_citations(q.get("citations")),
        })

    return [{
        "exam": {
            "id": exam_id,
            "title": title,
            "source": source,
            "question_count": exam.get("question_count") or len(normalized_questions),
        },
        "questions": normalized_questions,
    }]


def _normalize_flat_payload(file_name: str, payload: list) -> list[dict]:
    stem = os.path.splitext(file_name)[0]
    grouped: dict[str, list[dict]] = {}

    for raw in payload:
        if not isinstance(raw, dict):
            continue
        certification = raw.get("certification") or _detect_certification(file_name, stem) or "Question Bank"
        grouped.setdefault(str(certification), []).append(raw)

    bundles: list[dict] = []
    multi_group = len(grouped) > 1

    for certification, group_items in sorted(grouped.items(), key=lambda item: item[0]):
        if multi_group:
            exam_id = _slugify(f"{stem}-{certification}")
        else:
            exam_id = _slugify(stem)

        normalized_questions: list[dict] = []
        for raw in group_items:
            qid = str(raw.get("id") or "").strip()
            prompt = str(raw.get("question") or "").strip()
            if not qid or not prompt:
                continue

            options = _normalize_options(raw.get("options"))
            correct_options = _normalize_correct_keys(raw, options)
            if not options or not correct_options:
                continue

            domain = raw.get("domain") or raw.get("domain_primary")
            justification = raw.get("justification") or raw.get("explanation")
            tags = _normalize_tags(raw.get("tags"))
            tags.extend(tag for tag in _normalize_tags(raw.get("cross_domain_tags")) if tag.lower() not in {t.lower() for t in tags})

            normalized_questions.append({
                "id": qid,
                "question": prompt,
                "multi_select": bool(raw.get("multi_select", False) or len(correct_options) > 1),
                "options": options,
                "correct_options": correct_options,
                "justification": justification,
                "domain": domain,
                "difficulty": raw.get("difficulty"),
                "certification": raw.get("certification") or certification,
                "tags": tags,
                "citations": _normalize_citations(raw.get("citations")),
            })

        bundles.append({
            "exam": {
                "id": exam_id,
                "title": f"{certification} - Banco de Questoes",
                "source": file_name,
                "question_count": len(normalized_questions),
            },
            "questions": normalized_questions,
        })

    return bundles


def _normalize_payload(file_name: str, payload) -> list[dict]:
    if isinstance(payload, dict):
        return _normalize_wrapped_payload(file_name, payload)
    if isinstance(payload, list):
        return _normalize_flat_payload(file_name, payload)
    raise ValueError("Unsupported JSON structure")


def _needs_metadata_refresh(db: Session, bundles: list[dict]) -> bool:
    for bundle in bundles:
        exam = bundle.get("exam") or {}
        exam_id = str(exam.get("id") or "").strip()
        if exam_id and not db.get(Exam, exam_id):
            return True

        for q in bundle.get("questions") or []:
            qid = str(q.get("id") or "").strip()
            if not qid:
                continue
            existing = db.get(Question, qid)
            if not existing:
                return True
            if q.get("domain") and existing.domain != q.get("domain"):
                return True
            if q.get("difficulty") and existing.difficulty != q.get("difficulty"):
                return True
            if q.get("certification") and existing.certification != q.get("certification"):
                return True
            if q.get("tags") and not existing.tags_json:
                return True
            if q.get("citations") and not existing.citations_json:
                return True
    return False


def _delete_empty_exams(db: Session) -> None:
    empty_exam_ids = db.execute(
        select(Exam.id)
        .outerjoin(Question, Question.exam_id == Exam.id)
        .group_by(Exam.id)
        .having(func.count(Question.id) == 0)
    ).scalars().all()

    for exam_id in empty_exam_ids:
        exam = db.get(Exam, exam_id)
        if exam:
            db.delete(exam)


def ingest_questions_from_dir(db: Session, dir_path: str) -> dict:
    dir_path = os.path.abspath(dir_path)
    if not os.path.isdir(dir_path):
        return {"imported": 0, "skipped": 0, "errors": [f"QUESTION_JSON_DIR not found: {dir_path}"]}

    imported = 0
    skipped = 0
    errors: list[str] = []

    for name in sorted(os.listdir(dir_path)):
        if not name.lower().endswith(".json"):
            continue
        file_path = os.path.join(dir_path, name)
        try:
            digest = _sha256_file(file_path)

            with open(file_path, "r", encoding="utf-8") as f:
                payload = json.load(f)

            bundles = _normalize_payload(name, payload)
            if not bundles:
                raise ValueError("No supported questions found")

            # skip if exact file hash already imported and no metadata backfill is needed
            exists_stmt = select(ImportState).where(ImportState.file_name == name, ImportState.file_sha256 == digest)
            existing_import = db.execute(exists_stmt).scalar_one_or_none()
            if existing_import and not _needs_metadata_refresh(db, bundles):
                skipped += 1
                continue

            for bundle in bundles:
                exam = bundle.get("exam") or {}
                questions = bundle.get("questions") or []
                exam_id = str(exam.get("id") or "").strip()
                title = str(exam.get("title") or exam_id or name).strip()
                if not exam_id:
                    raise ValueError("Missing exam.id")

                db_exam = db.get(Exam, exam_id)
                if not db_exam:
                    db_exam = Exam(
                        id=exam_id,
                        title=title,
                        source=exam.get("source"),
                        question_count=exam.get("question_count"),
                    )
                    db.add(db_exam)
                else:
                    db_exam.title = title
                    db_exam.source = exam.get("source")
                    db_exam.question_count = exam.get("question_count")

                for q in questions:
                    qid = q.get("id")
                    prompt = q.get("question")
                    if not qid or not prompt:
                        continue

                    tags_json = json.dumps(_normalize_tags(q.get("tags")), ensure_ascii=False) if q.get("tags") else None
                    citations_json = json.dumps(_normalize_citations(q.get("citations")), ensure_ascii=False) if q.get("citations") else None
                    db_q = db.get(Question, qid)
                    if not db_q:
                        db_q = Question(
                            id=qid,
                            exam_id=exam_id,
                            prompt=prompt,
                            multi_select=bool(q.get("multi_select", False)),
                            domain=q.get("domain"),
                            difficulty=q.get("difficulty"),
                            certification=q.get("certification"),
                            tags_json=tags_json,
                            citations_json=citations_json,
                        )
                        db.add(db_q)
                    else:
                        db_q.exam_id = exam_id
                        db_q.prompt = prompt
                        db_q.multi_select = bool(q.get("multi_select", False))
                        db_q.domain = q.get("domain")
                        db_q.difficulty = q.get("difficulty")
                        db_q.certification = q.get("certification")
                        db_q.tags_json = tags_json
                        db_q.citations_json = citations_json

                    if db_q.options:
                        for opt in list(db_q.options):
                            db.delete(opt)

                    correct_set = set((q.get("correct_options") or []))
                    for opt in q.get("options") or []:
                        key = str(opt.get("key", "")).strip().upper()
                        text = str(opt.get("text", "")).strip()
                        if not key or not text:
                            continue
                        db.add(Option(question_id=qid, key=key, text=text, is_correct=(key in correct_set)))

                    just = q.get("justification")
                    db_exp = db.get(Explanation, qid)
                    if not db_exp:
                        db.add(Explanation(question_id=qid, justification=just))
                    else:
                        db_exp.justification = just

            _delete_empty_exams(db)

            if not existing_import:
                db.add(ImportState(file_name=name, file_sha256=digest))
            db.commit()
            imported += 1

        except Exception as e:
            db.rollback()
            errors.append(f"{name}: {e}")

    return {"imported": imported, "skipped": skipped, "errors": errors}
