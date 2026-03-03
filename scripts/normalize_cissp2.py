from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from enrich_epub_references import (
    CISSP_BOOK_PATH,
    CISSP_DOMAIN_CHAPTER,
    ROOT,
    BookIndex,
    build_citation,
)


CISSP2_FILE = ROOT / "questions" / "cissp2.json"
UNSUPPORTED_OPTION_TEXTS = ["Mastered", "Not Mastered"]

CANONICAL_DOMAINS = [
    "Security and Risk Management",
    "Asset Security",
    "Security Architecture and Engineering",
    "Communication and Network Security",
    "Identity and Access Management (IAM)",
    "Security Assessment and Testing",
    "Security Operations",
    "Software Development Security",
]

VALID_DOMAIN_SET = set(CANONICAL_DOMAINS)
FILE_TO_DOMAIN = {
    file_name: domain
    for domain, file_name in CISSP_DOMAIN_CHAPTER.items()
    if domain in VALID_DOMAIN_SET
}

DOMAIN_KEYWORDS = {
    "Security and Risk Management": [
        "risk", "governance", "policy", "compliance", "privacy", "law", "regulation",
        "legal", "ethics", "awareness", "training", "vendor", "third party", "bia",
        "business impact", "business continuity", "disaster recovery", "drp", "bcp",
        "pii", "phi", "intellectual property", "copyright", "patent", "license",
        "due care", "due diligence", "acceptable use", "classification", "retention",
    ],
    "Asset Security": [
        "asset", "inventory", "ownership", "custodian", "classification", "labeling",
        "retention", "disposal", "destruction", "degaussing", "overwriting", "media",
        "backup tape", "backup tapes", "sanitize", "sanitization", "data owner",
    ],
    "Security Architecture and Engineering": [
        "architecture", "kernel", "memory", "hardware", "firmware", "trusted",
        "reference monitor", "tcb", "tpm", "hsm", "crypto", "cryptography", "cipher",
        "encryption", "hash", "salt", "virtualization", "hypervisor", "security model",
        "bell-lapadula", "biba", "clark-wilson", "brewer", "nash", "hal", "database",
    ],
    "Communication and Network Security": [
        "network", "firewall", "router", "switch", "vpn", "wireless", "wifi",
        "802.1x", "nac", "ids", "ips", "proxy", "dmz", "nat", "segmentation",
        "covert channel", "fiber", "twisted-pair", "coaxial", "packet", "ping",
        "spoofing", "dns", "osi", "tcp", "udp", "ws-security",
    ],
    "Identity and Access Management (IAM)": [
        "access control", "least privilege", "need to know", "account", "identity",
        "authentication", "authorization", "federation", "sso", "single sign-on",
        "kerberos", "radius", "tacacs", "ldap", "biometric", "token", "smart card",
        "badge", "rfid", "provisioning", "deprovisioning", "role", "rbac", "abac",
        "dac", "mac", "multifactor", "mfa",
    ],
    "Security Assessment and Testing": [
        "assessment", "audit", "auditability", "test", "testing", "review", "metrics",
        "vulnerability", "pentest", "penetration", "fuzz", "fuzzing", "scan", "sast",
        "dast", "code review", "sampling", "evidence", "coverage", "effectiveness",
    ],
    "Security Operations": [
        "incident", "response", "forensic", "logging", "log", "monitoring", "siem",
        "backup", "restore", "recovery", "continuity", "operations", "patch",
        "change management", "configuration management", "job rotation", "separation",
        "containment", "eradication", "lessons learned",
    ],
    "Software Development Security": [
        "software", "application", "code", "sdlc", "secure development", "devsecops",
        "source code", "compiler", "input validation", "injection", "overflow",
        "database query", "stored procedure", "object-oriented", "agile", "scrum",
        "version control", "repository", "api", "black box", "white box", "unit test",
    ],
}

CONCEPT_PATTERNS = [
    (r"\bbusiness impact analysis\b|\bbia\b", "Business Impact Analysis (BIA)"),
    (r"\bbusiness continuity\b|\bbcp\b", "Business Continuity"),
    (r"\bdisaster recovery\b|\bdrp\b|\bbc/dr\b", "Disaster Recovery"),
    (r"\brisk assessment\b", "Risk Assessment"),
    (r"\brisk management\b", "Risk Management"),
    (r"\bintellectual property\b|\bip rights\b", "Intellectual Property"),
    (r"\bcopyright\b", "Copyright"),
    (r"\bpatent\b", "Patent"),
    (r"\bdata classification\b|\bclassification\b", "Data Classification"),
    (r"\bdata retention\b|\bretention\b", "Data Retention"),
    (r"\bmedia sanitization\b|\bdegauss\w*\b|\boverwrit\w*\b", "Media Sanitization"),
    (r"\b(?:un)?encrypt\w*\b|\bcryptograph\w*\b", "Cryptography"),
    (r"\bdigital signature\b", "Digital Signatures"),
    (r"\bpublic key\b|\bpki\b|\bcertificate\b", "PKI"),
    (r"\bhash\w*\b", "Hashing"),
    (r"\bfirewall\b", "Firewalls"),
    (r"\bids\b|\bintrusion detection\b", "Intrusion Detection"),
    (r"\bips\b|\bintrusion prevention\b", "Intrusion Prevention"),
    (r"\bvpn\b", "VPN"),
    (r"\b802\.1x\b|\bnac\b", "Network Access Control (NAC)"),
    (r"\bwireless\b|\bwifi\b", "Wireless Security"),
    (r"\bcovert channel\b", "Covert Channels"),
    (r"\bspoof\w*\b", "Spoofing"),
    (r"\baccess control\b", "Access Control"),
    (r"\bleast privilege\b", "Least Privilege"),
    (r"\bneed to know\b", "Need to Know"),
    (r"\bmultifactor\b|\bmfa\b", "Multi-Factor Authentication (MFA)"),
    (r"\bbiometric\w*\b", "Biometrics"),
    (r"\brfid\b", "RFID"),
    (r"\bkerberos\b", "Kerberos"),
    (r"\bradius\b", "RADIUS"),
    (r"\btacacs\+?\b", "TACACS+"),
    (r"\bfederat\w*\b|\bsso\b", "Federated Identity"),
    (r"\baccount provisioning\b|\bprovisioning\b", "Provisioning"),
    (r"\baudit\w*\b", "Auditing"),
    (r"\bvulnerability management\b|\bvulnerability\b", "Vulnerability Management"),
    (r"\bpenetration test\w*\b|\bpentest\b", "Penetration Testing"),
    (r"\bfuzz\w*\b", "Fuzz Testing"),
    (r"\bcode review\b", "Code Review"),
    (r"\bincident response\b|\bincident\b", "Incident Response"),
    (r"\bforensic\w*\b", "Digital Forensics"),
    (r"\blogg\w*\b|\bmonitoring\b", "Logging and Monitoring"),
    (r"\bbackup\b|\brestore\b", "Backup and Recovery"),
    (r"\bsecure sdlc\b|\bsdlc\b", "Secure SDLC"),
    (r"\binput validation\b", "Input Validation"),
    (r"\bblack box\b", "Black-Box Testing"),
    (r"\bchange management\b", "Change Management"),
    (r"\bconfiguration management\b", "Configuration Management"),
    (r"\bsecurity awareness\b|\bawareness training\b", "Security Awareness"),
]

ISO_RULES = [
    (r"\basset inventory\b|\binventory\b", "Annex A 5.9 and 5.10"),
    (r"\bclassification\b|\blabel\w*\b", "Annex A 5.12 and 5.13"),
    (r"\bretention\b|\bdisposal\b|\bdegauss\w*\b|\boverwrit\w*\b|\bdestruction\b", "Annex A 7.10 and 8.10"),
    (r"\baccess control\b|\bleast privilege\b|\bneed to know\b", "Annex A 5.15 to 5.18"),
    (r"\bmultifactor\b|\bmfa\b|\bauthentication\b|\bauthorization\b", "Annex A 5.17 and 8.5"),
    (r"\bcrypto\w*\b|\b(?:un)?encrypt\w*\b|\bcertificate\b|\bpki\b", "Annex A 8.24"),
    (r"\blogg\w*\b|\bmonitor\w*\b", "Annex A 8.15 and 8.16"),
    (r"\bvulnerability\b|\bpatch\w*\b", "Annex A 8.8 and 8.9"),
    (r"\bincident\b|\bforensic\w*\b", "Annex A 5.24 to 5.27"),
    (r"\bbusiness continuity\b|\bdisaster recovery\b|\bbc/dr\b", "Clause 8 and Annex A 5.30"),
    (r"\bnetwork\b|\bfirewall\b|\bvpn\b|\bsegmentation\b|\brouter\b|\bswitch\b", "Annex A 8.20 to 8.22"),
    (r"\bsoftware\b|\bcode\b|\bsdlc\b|\binput validation\b", "Annex A 8.25 to 8.29"),
    (r"\bvendor\b|\bsupplier\b|\bthird party\b", "Annex A 5.19 to 5.22"),
    (r"\bprivacy\b|\bpii\b|\bphi\b|\blegal\b|\bregulation\b|\bcompliance\b", "Clauses 4 to 6 and Annex A 5.31 to 5.34"),
]

DEFAULT_ISO_REFERENCES = {
    "Security and Risk Management": "Clauses 4 to 6 and Annex A 5",
    "Asset Security": "Annex A 5.9 to 5.13 and 7.10",
    "Security Architecture and Engineering": "Clause 8 and Annex A 8",
    "Communication and Network Security": "Annex A 8.20 to 8.22",
    "Identity and Access Management (IAM)": "Annex A 5.15 to 5.18",
    "Security Assessment and Testing": "Clauses 9 and 10",
    "Security Operations": "Clauses 8 to 10 and Annex A 5.24 to 5.30",
    "Software Development Security": "Annex A 8.25 to 8.29",
}

GENERIC_SECTION_TITLES = {
    "summary",
    "exam essentials",
    "review questions",
    "introduction",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize questions/cissp2.json into the canonical CISSP schema.")
    parser.add_argument("--write", action="store_true", help="Persist the normalized dataset to questions/cissp2.json.")
    return parser.parse_args()


def normalize_text(value: str | None) -> str:
    lowered = str(value or "").lower()
    lowered = re.sub(r"[^a-z0-9+.#/ -]+", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered)
    return lowered.strip()


def canonicalize_domain(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    if cleaned in VALID_DOMAIN_SET:
        return cleaned
    if cleaned == "Identity and Access Management":
        return "Identity and Access Management (IAM)"
    return None


def is_supported_question(question: dict[str, Any]) -> bool:
    options = question.get("options")
    if not isinstance(options, list) or len(options) < 2:
        return False
    texts = [str(item.get("text") or "").strip() for item in options if isinstance(item, dict)]
    if texts == UNSUPPORTED_OPTION_TEXTS:
        return False
    correct = {
        str(item).strip().upper()
        for item in (question.get("correct_options") or [])
        if str(item).strip()
    }
    available = {
        str(item.get("key") or "").strip().upper()
        for item in options
        if isinstance(item, dict) and str(item.get("key") or "").strip()
    }
    return bool(correct and correct.issubset(available))

def focused_options(question: dict[str, Any]) -> list[dict[str, Any]]:
    options = [item for item in (question.get("options") or []) if isinstance(item, dict)]
    correct_keys = {
        str(item).strip().upper()
        for item in (question.get("correct_options") or [])
        if str(item).strip()
    }
    focused = [
        item for item in options
        if str(item.get("key") or "").strip().upper() in correct_keys
    ]
    return focused or options


def build_corpus(question: dict[str, Any], focused: bool = True) -> str:
    parts = [str(question.get("question") or "")]
    options = focused_options(question) if focused else (question.get("options") or [])
    for option in options:
        if isinstance(option, dict):
            parts.append(str(option.get("text") or ""))
    return " ".join(parts)


def score_domains(question: dict[str, Any]) -> Counter[str]:
    corpus = normalize_text(build_corpus(question))
    scores: Counter[str] = Counter()
    for domain, keywords in DOMAIN_KEYWORDS.items():
        for keyword in keywords:
            if normalize_text(keyword) and normalize_text(keyword) in corpus:
                scores[domain] += 1
    return scores


def infer_domain(
    question: dict[str, Any],
    book: BookIndex,
) -> tuple[str, list[str], bool]:
    probe = {
        "question": question.get("question"),
        "options": focused_options(question),
        "correct_options": question.get("correct_options") or [],
        "justification": question.get("justification"),
        "tags": [],
        "domain": "",
    }
    section, _confidence, _match_terms, _fallback_used = book.match_question(probe)
    epub_domain = FILE_TO_DOMAIN.get(section.file_name)

    current_domain = canonicalize_domain(question.get("domain"))
    keyword_scores = score_domains(question)
    keyword_primary = None
    keyword_secondary: list[str] = []
    if keyword_scores:
        ordered = keyword_scores.most_common()
        keyword_primary = ordered[0][0]
        best_score = ordered[0][1]
        for domain, score in ordered[1:]:
            if score >= max(2, best_score - 1):
                keyword_secondary.append(domain)

    resolved_domain = current_domain
    domain_inferred = False

    if not resolved_domain:
        resolved_domain = keyword_primary or epub_domain or "Security and Risk Management"
        domain_inferred = True
    elif keyword_primary and keyword_primary != resolved_domain:
        if keyword_scores[keyword_primary] >= max(2, keyword_scores.get(resolved_domain, 0) + 1):
            resolved_domain = keyword_primary
            domain_inferred = True
    cross_domains: list[str] = []
    for domain in keyword_secondary:
        if domain != resolved_domain and domain not in cross_domains:
            cross_domains.append(domain)
    if epub_domain and epub_domain != resolved_domain and epub_domain not in cross_domains:
        if keyword_scores.get(epub_domain, 0) >= 2:
            cross_domains.append(epub_domain)

    return resolved_domain, cross_domains, domain_inferred


def match_section(question: dict[str, Any], domain: str, book: BookIndex) -> tuple[Any, float]:
    probe = {
        "question": question.get("question"),
        "options": focused_options(question),
        "correct_options": question.get("correct_options") or [],
        "justification": question.get("justification"),
        "tags": extract_concept_tags(question),
        "domain": domain,
    }
    section, confidence, _match_terms, _fallback_used = book.match_question(probe)
    return section, confidence


def infer_question_type(question: dict[str, Any]) -> str:
    prompt = str(question.get("question") or "")
    lower = prompt.lower()
    scenario_markers = (
        "organization", "company", "ciso", "administrator", "during", "wants to",
        "needs to", "has discovered", "best approach", "most effective", "scenario",
    )
    if any(marker in lower for marker in scenario_markers):
        return "application"
    if len(prompt.split()) >= 18:
        return "application"
    return "knowledge"


def infer_format_type(question_type: str) -> str:
    return "scenario_based" if question_type == "application" else "direct"


def infer_difficulty(question: dict[str, Any], domain: str, section: Any) -> str:
    prompt = str(question.get("question") or "")
    lower = prompt.lower()
    score = 0

    word_count = len(prompt.split())
    if word_count >= 14:
        score += 1
    if word_count >= 24:
        score += 1
    if word_count >= 36:
        score += 1

    option_texts = [
        str(option.get("text") or "")
        for option in question.get("options") or []
        if isinstance(option, dict)
    ]
    avg_option_words = sum(len(text.split()) for text in option_texts) / max(1, len(option_texts))
    if avg_option_words >= 4:
        score += 1
    if avg_option_words >= 7:
        score += 1

    if any(token in prompt for token in ("MOST", "LEAST", "BEST", "EXCEPT", "PRIMARY", "FIRST")):
        score += 1

    if infer_question_type(question) == "application":
        score += 1

    advanced_terms = (
        "covert channel", "bell-lapadula", "clark-wilson", "brewer", "nash", "ws-security",
        "fuzz", "kerberos", "radius", "tacacs", "rfid", "forensic", "hal", "hypervisor",
        "black box", "white box", "token", "certificate",
    )
    if any(term in lower for term in advanced_terms):
        score += 1

    if domain in {"Security Architecture and Engineering", "Software Development Security"}:
        score += 1
    if domain == "Security Assessment and Testing" and "test" in lower:
        score += 1
    if getattr(section, "level", 2) >= 3:
        score += 1

    if score <= 2:
        return "Easy"
    if score <= 5:
        return "Medium"
    return "Hard"


def section_tag(section: Any, domain: str) -> str | None:
    title = section_tag_label(section)
    if not title:
        return None
    if normalize_text(title) in GENERIC_SECTION_TITLES:
        return None
    if normalize_text(title) == normalize_text(domain):
        return None
    chapter_title = str(getattr(section, "chapter_title", "") or "").strip()
    if chapter_title and normalize_text(title) == normalize_text(chapter_title):
        return None
    return title


def section_tag_label(section: Any) -> str:
    title = str(getattr(section, "title", "") or "").strip()
    parent_titles = tuple(getattr(section, "parent_titles", ()) or ())
    if should_generalize_section(section) and parent_titles:
        return str(parent_titles[-1]).strip()
    return title


def should_generalize_section(section: Any) -> bool:
    title = str(getattr(section, "title", "") or "").strip()
    if not title:
        return False
    level = int(getattr(section, "level", 2) or 2)
    if level >= 4:
        return True
    words = [word for word in title.split() if word]
    if words and len(words) <= 5 and all(word.isupper() for word in words if any(ch.isalpha() for ch in word)):
        return True
    return False


def normalize_epub_citation(citation: dict[str, Any], section: Any) -> dict[str, Any]:
    if not should_generalize_section(section):
        return citation
    parent_titles = [str(item).strip() for item in (getattr(section, "parent_titles", ()) or ()) if str(item).strip()]
    if not parent_titles:
        return citation
    chapter = str(citation.get("chapter") or "").strip()
    path = [chapter] if chapter else []
    path.extend(parent_titles)
    citation["reference"] = " -> ".join(path)
    citation["section"] = " -> ".join(parent_titles)
    return citation


def extract_concept_tags(question: dict[str, Any]) -> list[str]:
    tags: list[str] = []

    def scan(corpus: str, limit: int) -> None:
        lowered = corpus.lower()
        for pattern, label in CONCEPT_PATTERNS:
            if label in tags:
                continue
            if re.search(pattern, lowered, flags=re.IGNORECASE):
                tags.append(label)
                if len(tags) >= limit:
                    return

    scan(build_corpus(question, focused=True), 3)
    if len(tags) < 2:
        scan(build_corpus(question, focused=False), 3)
    return tags


def build_tags(question: dict[str, Any], domain: str, section: Any) -> list[str]:
    tags: list[str] = []

    def add(value: str | None) -> None:
        text = str(value or "").strip()
        if not text:
            return
        key = normalize_text(text)
        if not key:
            return
        if key.startswith("exam topic"):
            return
        if any(normalize_text(existing) == key for existing in tags):
            return
        tags.append(text)

    add(domain)
    add(section_tag(section, domain))
    for tag in extract_concept_tags(question):
        add(tag)
        if len(tags) >= 5:
            break

    if len(tags) < 2:
        prompt = str(question.get("question") or "")
        acronym_match = re.findall(r"\b[A-Z][A-Z0-9.+/-]{1,}\b", prompt)
        for token in acronym_match:
            if token in {"MOST", "LEAST", "BEST", "EXCEPT", "PRIMARY"}:
                continue
            add(token)
            if len(tags) >= 4:
                break

    return tags


def build_cross_domain_tags(domain: str, cross_domains: list[str]) -> list[str]:
    tags = [domain]
    for item in cross_domains:
        if item not in VALID_DOMAIN_SET:
            continue
        if item not in tags:
            tags.append(item)
        if len(tags) >= 3:
            break
    return tags


def build_cbk_citation(domain: str, tags: list[str]) -> dict[str, str]:
    reference = domain
    if len(tags) >= 2 and tags[1] != domain:
        reference = f"{domain} ({tags[1]})"
    return {
        "source": "Official (ISC)\u00b2 CBK",
        "reference": reference,
    }


def build_iso_citation(question: dict[str, Any], domain: str) -> dict[str, str]:
    corpus = build_corpus(question).lower()
    for pattern, reference in ISO_RULES:
        if re.search(pattern, corpus, flags=re.IGNORECASE):
            return {
                "source": "ISO/IEC 27001",
                "reference": reference,
            }
    return {
        "source": "ISO/IEC 27001",
        "reference": DEFAULT_ISO_REFERENCES[domain],
    }


def normalize_options(question: dict[str, Any]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for option in question.get("options") or []:
        if not isinstance(option, dict):
            continue
        key = str(option.get("key") or "").strip().upper()
        text = str(option.get("text") or "").strip()
        if key and text:
            normalized.append({"key": key, "text": text})
    return normalized


def normalize_correct_options(question: dict[str, Any], options: list[dict[str, str]]) -> list[str]:
    valid_keys = {item["key"] for item in options}
    normalized: list[str] = []
    for value in question.get("correct_options") or []:
        key = str(value or "").strip().upper()
        if key and key in valid_keys and key not in normalized:
            normalized.append(key)
    return normalized


def compute_quality_score(
    tags: list[str],
    confidence: float,
    domain_inferred: bool,
    question_type: str,
) -> float:
    score = 68.0
    score += min(14.0, round(confidence * 12.0, 1))
    score += min(6.0, float(max(0, len(tags) - 1) * 2))
    if domain_inferred:
        score -= 3.0
    else:
        score += 2.0
    if question_type == "application":
        score += 2.0
    return round(max(58.0, min(92.0, score)), 1)


def normalize_question(question: dict[str, Any], book: BookIndex) -> tuple[dict[str, Any], dict[str, Any]]:
    domain, cross_domains, domain_inferred = infer_domain(question, book)
    section, confidence = match_section(question, domain, book)
    question_type = infer_question_type(question)
    format_type = infer_format_type(question_type)
    difficulty = infer_difficulty(question, domain, section)
    tags = build_tags(question, domain, section)
    cross_domain_tags = build_cross_domain_tags(domain, cross_domains)
    options = normalize_options(question)
    correct_options = normalize_correct_options(question, options)

    citations = [
        build_cbk_citation(domain, tags),
        build_iso_citation(question, domain),
        normalize_epub_citation(build_citation(book, section, confidence, []), section),
    ]

    normalized = {
        "id": str(question.get("id") or "").strip(),
        "question": str(question.get("question") or "").strip(),
        "multi_select": bool(question.get("multi_select")),
        "domain": domain,
        "difficulty": difficulty,
        "certification": "CISSP",
        "tags": tags,
        "cross_domain_tags": cross_domain_tags,
        "question_type": question_type,
        "format_type": format_type,
        "citations": citations,
        "source_materials": ["material/CISSP For Dummies.epub"],
        "question_set": "normalized_pdf_import",
        "quality_score": compute_quality_score(tags, confidence, domain_inferred, question_type),
        "options": options,
        "correct_options": correct_options,
        "justification": None,
    }

    report = {
        "domain_inferred": domain_inferred,
        "confidence": confidence,
        "domain": domain,
    }
    return normalized, report


def normalize_dataset(write_changes: bool) -> dict[str, Any]:
    payload = json.loads(CISSP2_FILE.read_text(encoding="utf-8"))
    questions = payload.get("questions")
    if not isinstance(questions, list):
        raise ValueError("Invalid cissp2 payload")

    book = BookIndex(
        material_path=CISSP_BOOK_PATH,
        source_name="CISSP For Dummies (EPUB)",
        certification="CISSP",
        cissp_domain_map=CISSP_DOMAIN_CHAPTER,
    )

    normalized_questions: list[dict[str, Any]] = []
    dropped_ids: list[str] = []
    inferred_domains = 0
    domain_distribution: Counter[str] = Counter()
    confidence_total = 0.0

    for question in questions:
        if not isinstance(question, dict):
            continue
        if not is_supported_question(question):
            dropped_ids.append(str(question.get("id") or ""))
            continue
        normalized, report = normalize_question(question, book)
        normalized_questions.append(normalized)
        if report["domain_inferred"]:
            inferred_domains += 1
        domain_distribution[report["domain"]] += 1
        confidence_total += float(report["confidence"])

    output = {
        "exam": {
            "id": "cissp2",
            "title": "ISC2 CISSP - Banco de Questoes",
            "source": "cissp2 normalized import",
            "question_count": len(normalized_questions),
            "certification": "CISSP",
            "schema_version": 2,
            "notes": (
                "Canonical normalized dataset derived from the original cissp2 PDF import. "
                "Unsupported non-multiple-choice prompts were filtered out; tags, difficulty, "
                "domains, and citations were inferred heuristically."
            ),
        },
        "questions": normalized_questions,
    }

    if write_changes:
        CISSP2_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    average_confidence = round(confidence_total / len(normalized_questions), 2) if normalized_questions else 0.0
    return {
        "file": str(CISSP2_FILE.relative_to(ROOT)),
        "write": write_changes,
        "retained": len(normalized_questions),
        "dropped": len(dropped_ids),
        "dropped_ids": dropped_ids,
        "domains_inferred_or_corrected": inferred_domains,
        "average_epub_confidence": average_confidence,
        "domain_distribution": dict(sorted(domain_distribution.items())),
    }


def main() -> None:
    args = parse_args()
    report = normalize_dataset(write_changes=args.write)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
