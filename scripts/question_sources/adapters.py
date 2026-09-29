"""Format adapters: raw source checkout -> Sentinel-Quiz schema v3 records (+ provenance).

Each adapter reads a checkout of the source at its pinned commit (see ``cache.fetch``)
and returns ``(questions, stats)``. Every record carries the provenance keys
(source_repo, source_commit, source_license, source_path, source_id) and
``needs_review = true``: nothing extracted from a third party is trusted before the
SME review (``review-apply``).

Adapters are reference implementations of the formats found at the pinned commits:

* ``secplus_mk``  data/questions-*.json   {id, domain(int), objective, topic, format, difficulty,
                                          stem, scenario?, options{A..}, answer(str|list), explanation}
* ``secplus_ia``  src/data/ch*_Test*.json + finalExam.json
                                          {id, objective("... Domain 1.0 ... Objective 1.2"), question,
                                          options{A..}, correct(str, may be empty), explanation}
* ``secplus_cj``  questions_db_final.json [{id, topic, question, options{A..}, answer, explanation}]
* ``ceh_psybeast`` index.html             ``var POOL=[{id, domain, source, q, opts[], ans(int), exp}]``
* ``ceh_rrpatil`` *.pdf (via ``pdftotext``) or *.txt
                                          "N. question / a) .. d) / Answer: c) .. / Explanation: .."
* ``gideon``      not a question bank (LLM scenario generator): nothing to extract.
"""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

SECPLUS_DOMAINS = {
    1: "General Security Concepts",
    2: "Threats, Vulnerabilities and Mitigations",
    3: "Security Architecture",
    4: "Security Operations",
    5: "Security Program Management and Oversight",
}
CEH_DEFAULT_DOMAIN = "Information Security and Ethical Hacking Overview"
# Module (or module-like label) -> CEH v13 blueprint domain (ceh_v13_blueprint.json).
CEH_MODULE_DOMAINS = {
    "introduction to ethical hacking": "Information Security and Ethical Hacking Overview",
    "footprinting & reconnaissance": "Reconnaissance Techniques",
    "footprinting and reconnaissance": "Reconnaissance Techniques",
    "scanning networks": "Reconnaissance Techniques",
    "enumeration": "Reconnaissance Techniques",
    "vulnerability analysis": "System Hacking Phases and Attack Techniques",
    "system hacking": "System Hacking Phases and Attack Techniques",
    "malware threats": "System Hacking Phases and Attack Techniques",
    "sniffing": "Network and Perimeter Hacking",
    "social engineering": "Network and Perimeter Hacking",
    "denial of service": "Network and Perimeter Hacking",
    "denial-of-service": "Network and Perimeter Hacking",
    "session hijacking": "Network and Perimeter Hacking",
    "ids / firewall evasion": "Network and Perimeter Hacking",
    "evading ids, firewalls, and honeypots": "Network and Perimeter Hacking",
    "web server hacking": "Web Application Hacking",
    "hacking web servers": "Web Application Hacking",
    "web application hacking": "Web Application Hacking",
    "hacking web applications": "Web Application Hacking",
    "sql injection": "Web Application Hacking",
    "wireless network hacking": "Wireless Network Hacking",
    "hacking wireless networks": "Wireless Network Hacking",
    "mobile platform hacking": "Mobile Platform, IoT, and OT Hacking",
    "hacking mobile platforms": "Mobile Platform, IoT, and OT Hacking",
    "iot and ot hacking": "Mobile Platform, IoT, and OT Hacking",
    "cloud computing security": "Cloud Computing",
    "cloud computing": "Cloud Computing",
    "cryptography": "Cryptography",
}
CJ_TOPICS = {
    "1. General Security Concepts": 1,
    "2. Threats & Vulnerabilities": 2,
    "3. Security Architecture": 3,
    "4. Security Operations": 4,
    "5. Security Program Management": 5,
}
DIFFICULTIES = {"easy": "Easy", "medium": "Medium", "hard": "Hard"}


class AdapterError(Exception):
    pass


def _format_type(text: str) -> str:
    if len(text) > 170 or re.search(
        r"\b(company|organization|organisation|administrator|analyst|engineer|team|user|employee|firm|hospital|bank)\b",
        text,
        re.I,
    ):
        return "scenario_based"
    return "direct"


def build_record(
    source: dict[str, Any],
    number: int,
    *,
    question: str,
    options: dict[str, str],
    correct: list[str],
    justification: str | None,
    domain: str,
    difficulty: str = "Medium",
    tags: list[str | None] | None = None,
    source_path: str,
    source_id: str,
    source_exam_title: str,
    notes: list[str] | None = None,
    objective: str | None = None,
) -> dict[str, Any]:
    keys = sorted({str(k).strip().upper() for k in correct if str(k).strip()})
    multi = len(keys) > 1
    certification = source.get("certification")
    citations = [{"source": source["name"], "reference": f"{source_path}#{source_id}"}]
    if objective and certification == "Security+":
        citations.insert(0, {"source": "CompTIA Security+ SY0-701 Objectives", "reference": f"Objective {objective}"})
    return {
        "id": f"ext_{source['id_prefix']}_{number:04d}",
        "question": question.strip(),
        "language": source.get("language") or "en",
        "multi_select": multi,
        "domain": domain,
        "difficulty": DIFFICULTIES.get(str(difficulty or "").strip().lower(), "Medium"),
        "certification": certification,
        "tags": [tag for tag in (tags or []) if tag],
        "cross_domain_tags": [],
        "question_type": "multiple_response" if multi else "single_response",
        "cognitive_level": None,
        "format_type": _format_type(question),
        "citations": citations,
        "source_materials": [],
        "question_set": f"external_{source['id_prefix']}",
        "quality_score": None,
        "source_exam_id": source_id,
        "source_exam_title": source_exam_title,
        "legacy_source_file": source_path,
        "options": [{"key": key, "text": str(text).strip()} for key, text in options.items()],
        "correct_options": keys,
        "justification": (justification or "").strip() or None,
        "needs_review": True,
        "review_notes": "; ".join(notes or []) or None,
        "source_repo": source["url"],
        "source_commit": source["commit"],
        "source_license": source["license"],
        "source_path": source_path,
        "source_id": str(source_id),
    }


def _letters(values: list[str]) -> dict[str, str]:
    return {chr(65 + index): str(value) for index, value in enumerate(values)}


# --------------------------------------------------------------------------- Security+

def extract_secplus_mk(source: dict[str, Any], root: Path) -> tuple[list[dict], dict]:
    files = sorted(glob.glob(str(root / "data" / "questions-*.json")))
    if not files:
        raise AdapterError("data/questions-*.json not found")
    out: list[dict] = []
    n = 0
    for path in files:
        rel = os.path.relpath(path, root)
        for q in json.loads(Path(path).read_text(encoding="utf-8")):
            n += 1
            question = str(q["stem"])
            if q.get("scenario"):
                question = f"{str(q['scenario']).strip()}\n\n{question.strip()}"
            answer = q["answer"] if isinstance(q["answer"], list) else [q["answer"]]
            explanation = str(q.get("explanation") or "")
            if q.get("comptia_logic_note"):
                explanation += f"\n\nCompTIA logic: {q['comptia_logic_note']}"
            out.append(build_record(
                source, n, question=question, options=q["options"], correct=answer, justification=explanation,
                domain=SECPLUS_DOMAINS[int(q["domain"])], difficulty=q.get("difficulty") or "Medium",
                tags=[f"external:{source['id']}", q.get("topic"), f"obj {q['objective']}" if q.get("objective") else None],
                objective=q.get("objective"), source_path=rel, source_id=str(q["id"]),
                source_exam_title=f"{source['name']} {os.path.basename(path)}",
            ))
    return out, {"count": len(out)}


def extract_secplus_ia(source: dict[str, Any], root: Path) -> tuple[list[dict], dict]:
    data_dir = root / "src" / "data"
    files = sorted(glob.glob(str(data_dir / "ch*_Test*.json")))
    if (data_dir / "finalExam.json").is_file():
        files.append(str(data_dir / "finalExam.json"))
    if not files:
        raise AdapterError("src/data/*.json not found")
    out: list[dict] = []
    stats = {"answer_key_missing_inferred": 0, "answer_key_missing_uninferable": 0}
    n = 0
    for path in files:
        rel = os.path.relpath(path, root)
        chapter = re.match(r"ch(\d)_", os.path.basename(path))
        for q in json.loads(Path(path).read_text(encoding="utf-8")):
            n += 1
            objective_match = re.search(r"Objective (\d\.\d)", str(q.get("objective") or ""))
            domain_match = re.search(r"Domain (\d)\.0", str(q.get("objective") or ""))
            objective = objective_match.group(1) if objective_match else None
            if objective:
                domain_number = int(objective[0])
            elif domain_match:
                domain_number = int(domain_match.group(1))
            elif chapter:
                domain_number = int(chapter.group(1))
            else:
                domain_number = 2
            notes: list[str] = []
            correct = str(q.get("correct") or "").strip()
            if not correct:
                cited = set(re.findall(r"\(([A-E])\)", str(q.get("explanation") or "")))
                missing = [key for key in q["options"] if key not in cited]
                if len(missing) == 1:
                    correct = missing[0]
                    stats["answer_key_missing_inferred"] += 1
                    notes.append("empty answer key in the source; inferred from the explanation (the only option not cited as wrong)")
                else:
                    stats["answer_key_missing_uninferable"] += 1
                    correct = missing[0] if missing else sorted(q["options"])[0]
                    notes.append("empty answer key in the source that could not be inferred: placeholder key, fix in review")
            out.append(build_record(
                source, n, question=q["question"], options=q["options"], correct=[correct], justification=q.get("explanation"),
                domain=SECPLUS_DOMAINS.get(domain_number, SECPLUS_DOMAINS[2]),
                tags=[f"external:{source['id']}", f"obj {objective}" if objective else None, Path(path).stem],
                objective=objective, source_path=rel, source_id=str(q.get("id")),
                source_exam_title=f"{source['name']} {os.path.basename(path)}", notes=notes,
            ))
    stats["count"] = len(out)
    return out, stats


def extract_secplus_cj(source: dict[str, Any], root: Path) -> tuple[list[dict], dict]:
    path = root / "questions_db_final.json"
    if not path.is_file():
        raise AdapterError("questions_db_final.json not found")
    out: list[dict] = []
    for n, q in enumerate(json.loads(path.read_text(encoding="utf-8")), 1):
        notes: list[str] = []
        domain_number = CJ_TOPICS.get(str(q.get("topic") or ""))
        if domain_number is None:
            notes.append(f"source topic {q.get('topic')!r} has no SY0-701 domain: placeholder domain, set it in review")
            domain_number = 2
        out.append(build_record(
            source, n, question=q["question"], options=dict(sorted(q["options"].items())), correct=[q["answer"]],
            justification=q.get("explanation"), domain=SECPLUS_DOMAINS[domain_number],
            tags=[f"external:{source['id']}", q.get("topic")], source_path=path.name, source_id=str(q.get("id")),
            source_exam_title=f"{source['name']} {path.name}", notes=notes,
        ))
    return out, {"count": len(out)}


# --------------------------------------------------------------------------- CEH

def extract_ceh_psybeast(source: dict[str, Any], root: Path) -> tuple[list[dict], dict]:
    path = root / "index.html"
    if not path.is_file():
        raise AdapterError("index.html not found")
    html = path.read_text(encoding="utf-8")
    marker = "var POOL="
    if marker not in html:
        raise AdapterError("'var POOL=' not found in index.html")
    pool, _end = json.JSONDecoder().raw_decode(html[html.index(marker) + len(marker):])
    out: list[dict] = []
    unmapped = 0
    for n, q in enumerate(pool, 1):
        label = str(q.get("domain") or "").strip()
        domain = CEH_MODULE_DOMAINS.get(label.lower())
        notes: list[str] = []
        if domain is None:
            unmapped += 1
            domain = CEH_DEFAULT_DOMAIN
            notes.append(f"source label {label!r} is not a CEH module: placeholder domain, set it in review")
        answers = q["ans"] if isinstance(q["ans"], list) else [q["ans"]]
        options = _letters(q["opts"])
        out.append(build_record(
            source, n, question=q["q"], options=options, correct=[chr(65 + int(a)) for a in answers],
            justification=q.get("exp"), domain=domain, tags=[f"external:{source['id']}", label, q.get("source")],
            source_path="index.html", source_id=str(q.get("id")), source_exam_title=f"{source['name']} POOL", notes=notes,
        ))
    return out, {"count": len(out), "unmapped_domain": unmapped}


_RRP_ITEM = re.compile(r"(?ms)^\s*(\d{1,3})\.\s+(.+?)(?=^\s*\d{1,3}\.\s+|\Z)")
_RRP_OPTION = re.compile(r"(?m)^\s*([a-eA-E])[).]\s*(.+)$")
_RRP_ANSWER = re.compile(r"(?m)^\s*(?:Correct\s+)?Answer\s*:\s*([a-eA-E])\b[).]?")


def parse_mcq_text(text: str) -> list[dict[str, Any]]:
    """Parse numbered MCQ blocks of a PDF text dump.

    Accepted layouts: options ``a)``/``A)``/``A.``; answer ``Answer: c) ...`` or
    ``Correct Answer: D``; the rest of the block (``Explanation: ...`` or free text) is
    the explanation.
    """
    items: list[dict[str, Any]] = []
    for match in _RRP_ITEM.finditer(text):
        number, body = int(match.group(1)), match.group(2)
        answer_match = _RRP_ANSWER.search(body)
        if not answer_match:
            continue
        head = body[:answer_match.start()]
        first_option = _RRP_OPTION.search(head)
        if not first_option:
            continue
        question = re.sub(r"\s+", " ", head[:first_option.start()]).strip()
        options = {m.group(1).upper(): re.sub(r"\s+", " ", m.group(2)).strip() for m in _RRP_OPTION.finditer(head)}
        answer = answer_match.group(1).upper()
        if len(options) < 2 or answer not in options or not question:
            continue
        rest = body[answer_match.end():]
        rest = rest.split("\n", 1)[1] if "\n" in rest else ""
        explanation = re.sub(r"^\s*Explanation\s*:\s*", "", rest.strip())
        explanation = re.sub(r"\s+", " ", explanation).strip() or None
        items.append({"number": number, "question": question, "options": options, "answer": answer, "explanation": explanation})
    return items


def _pdf_text(path: Path) -> str:
    binary = shutil.which("pdftotext")
    if not binary:
        raise AdapterError("pdftotext (poppler-utils) is required to read the PDF source")
    result = subprocess.run([binary, str(path), "-"], check=True, capture_output=True, text=True)
    return result.stdout


def extract_ceh_rrpatil(source: dict[str, Any], root: Path) -> tuple[list[dict], dict]:
    texts = sorted(root.glob("*.txt"))
    pdfs = sorted(root.glob("*.pdf"))
    if texts:
        text, rel = texts[0].read_text(encoding="utf-8"), texts[0].name
    elif pdfs:
        text, rel = _pdf_text(pdfs[0]), pdfs[0].name
    else:
        raise AdapterError("no *.pdf or *.txt found")
    out: list[dict] = []
    for n, item in enumerate(parse_mcq_text(text), 1):
        out.append(build_record(
            source, n, question=item["question"], options=item["options"], correct=[item["answer"]],
            justification=item["explanation"], domain=CEH_DEFAULT_DOMAIN,
            tags=[f"external:{source['id']}"], source_path=rel, source_id=str(item["number"]),
            source_exam_title=f"{source['name']} {rel}",
            notes=["source has no domains: placeholder domain, set it in review"],
        ))
    return out, {"count": len(out)}


def extract_gideon(source: dict[str, Any], root: Path) -> tuple[list[dict], dict]:
    raise AdapterError(
        "siriusbkid-gideon-pbq-generator is an LLM scenario generator, not a question bank: nothing to extract"
    )


ADAPTERS: dict[str, Callable[[dict[str, Any], Path], tuple[list[dict], dict]]] = {
    "secplus_mk": extract_secplus_mk,
    "secplus_ia": extract_secplus_ia,
    "secplus_cj": extract_secplus_cj,
    "ceh_psybeast": extract_ceh_psybeast,
    "ceh_rrpatil": extract_ceh_rrpatil,
    "gideon": extract_gideon,
}


def extract(source: dict[str, Any], root: Path) -> tuple[list[dict], dict]:
    adapter = ADAPTERS.get(str(source.get("adapter") or ""))
    if adapter is None:
        raise AdapterError(f"no adapter {source.get('adapter')!r} for {source['id']}")
    return adapter(source, Path(root))
