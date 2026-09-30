"""Offline question → book-section linking (runs in scripts/build_study_links.py, not per request).

For every question it picks the sections that best explain it and, for each wrong option, the
section that defines that option's concept ("why C is a distractor"). Scoring is BM25 over the
normalized teaching sections of the question's certification, plus priors:

* the section the question already cites (legacy EPUB locator) and its subtree;
* exam domain (Security+/CISSP objective codes parsed from the books) or CEH module;
* a penalty for chapter summaries (teaching text is preferred).

Security+ questions are partly written in Portuguese while the books are in English, so the query
also keeps English terms written in parentheses ("Personificação (Impersonating)"), the
citation's ``match_terms`` and a small PT→EN glossary of security vocabulary.

Only section ids and scores are stored (no book text), so the output can live in the repository.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from app.services.material_corpus import CorpusSection, MaterialCorpus

_TOKEN = re.compile(r"[a-z0-9]+(?:[.\-/][a-z0-9]+)*")
_PARENTHESIZED = re.compile(r"\(([^()]{2,60})\)")

STOPWORDS = frozenset(
    """a an and are as at be been being but by can could did do does for from had has have how if in into is it its
    may might more most must no not of on or other should so such than that the their them then there these they this
    those through to under use used using was were what when where which while who why will with would you your
    best first following likely most next primary select true false which? all both each only also
    a o os as um uma uns umas de do da dos das em no na nos nas por para com sem que qual quais quando onde como
    e ou se ao aos mais menos melhor seguinte seguintes sobre entre ser estar foi sao sua seu suas seus isso esta este
    essa esse pelo pela pelos pelas uma deve pode podem ja nao sim tipo tipos caso cenario empresa organizacao""".split()
)

# Portuguese security vocabulary → English book terms (accents stripped, lowercase).
PT_EN_GLOSSARY: dict[str, str] = {
    "criptografia": "encryption cryptography", "criptografar": "encrypt encryption", "cifra": "cipher",
    "autenticacao": "authentication", "autorizacao": "authorization", "contabilizacao": "accounting",
    "ameaca": "threat", "ameacas": "threats", "vulnerabilidade": "vulnerability", "vulnerabilidades": "vulnerabilities",
    "ataque": "attack", "ataques": "attacks", "atacante": "attacker", "invasor": "attacker intruder",
    "senha": "password", "senhas": "passwords", "chave": "key", "chaves": "keys", "rede": "network", "redes": "networks",
    "nuvem": "cloud", "politica": "policy", "politicas": "policies", "risco": "risk", "riscos": "risks",
    "controle": "control", "controles": "controls", "auditoria": "audit", "backup": "backup",
    "recuperacao": "recovery", "desastre": "disaster", "desastres": "disaster", "continuidade": "continuity",
    "incidente": "incident", "incidentes": "incidents", "resposta": "response", "engenharia": "engineering",
    "social": "social", "personificacao": "impersonation", "desinformacao": "disinformation",
    "certificado": "certificate", "certificados": "certificates", "assinatura": "signature", "digital": "digital",
    "integridade": "integrity", "confidencialidade": "confidentiality", "disponibilidade": "availability",
    "repudio": "repudiation nonrepudiation", "privilegio": "privilege", "privilegios": "privileges",
    "segmentacao": "segmentation", "varredura": "scan scanning", "varreduras": "scans", "analise": "analysis",
    "malicioso": "malicious", "maliciosa": "malicious", "codigo": "code", "virus": "virus", "verme": "worm",
    "cavalo": "trojan", "troia": "trojan", "resgate": "ransomware", "sequestro": "hijacking",
    "identidade": "identity", "acesso": "access", "gerenciamento": "management", "gestao": "management",
    "conformidade": "compliance", "regulamentacao": "regulation", "lei": "law", "leis": "laws",
    "privacidade": "privacy", "dados": "data", "classificacao": "classification", "proprietario": "owner",
    "custodiante": "custodian", "retencao": "retention", "descarte": "disposal destruction", "sanitizacao": "sanitization",
    "fisica": "physical", "fisico": "physical", "seguranca": "security", "vigilancia": "surveillance",
    "biometria": "biometrics", "biometrico": "biometric", "token": "token", "fator": "factor", "fatores": "factors",
    "multifator": "multifactor mfa", "sessao": "session", "sessoes": "sessions", "cookie": "cookie",
    "injecao": "injection", "estouro": "overflow", "memoria": "memory", "negacao": "denial",
    "servico": "service", "servicos": "services", "distribuida": "distributed", "trafego": "traffic",
    "pacote": "packet", "pacotes": "packets", "porta": "port", "portas": "ports", "protocolo": "protocol",
    "roteador": "router", "comutador": "switch", "sem": "", "fio": "wireless", "movel": "mobile", "moveis": "mobile",
    "dispositivo": "device", "dispositivos": "devices", "endpoint": "endpoint", "aplicacao": "application",
    "aplicacoes": "applications", "desenvolvimento": "development", "software": "software", "teste": "test testing",
    "testes": "tests testing", "invasao": "penetration intrusion", "intrusao": "intrusion", "deteccao": "detection",
    "prevencao": "prevention", "monitoramento": "monitoring", "registro": "log logging", "registros": "logs",
    "evidencia": "evidence", "forense": "forensics forensic", "cadeia": "chain", "custodia": "custody",
    "mudanca": "change", "mudancas": "changes", "configuracao": "configuration", "atualizacao": "patch update",
    "correcao": "patch remediation", "mitigacao": "mitigation", "hardening": "hardening", "endurecimento": "hardening",
    "virtualizacao": "virtualization", "conteiner": "container", "microsservicos": "microservices",
    "treinamento": "training", "conscientizacao": "awareness", "fornecedor": "vendor supplier", "terceiros": "third party",
    "contrato": "contract agreement", "acordo": "agreement", "impacto": "impact", "negocio": "business",
    "probabilidade": "likelihood probability", "residual": "residual", "transferir": "transfer", "transferencia": "transfer",
    "aceitar": "accept acceptance", "evitar": "avoid avoidance", "mitigar": "mitigate mitigation", "seguro": "insurance",
    "governanca": "governance", "diretor": "executive", "executivo": "executive", "funcionario": "employee",
    "usuario": "user", "usuarios": "users", "conta": "account", "contas": "accounts", "zero": "zero", "confianca": "trust",
}

# Security+ and CISSP domain names as used in the question banks → domain number.
DOMAIN_NUMBERS: dict[str, int] = {
    "general security concepts": 1,
    "threats, vulnerabilities and mitigations": 2,
    "threats, vulnerabilities, and mitigations": 2,
    "security architecture": 3,
    "security operations": 4,
    "security program management and oversight": 5,
    "security and risk management": 1,
    "asset security": 2,
    "security architecture and engineering": 3,
    "communication and network security": 4,
    "identity and access management": 5,
    "identity and access management (iam)": 5,
    "security assessment and testing": 6,
    "software development security": 8,
}
CISSP_DOMAIN_OVERRIDES = {"security operations": 7}


def certification_key(value: str | None) -> str | None:
    text = str(value or "").lower()
    if "security+" in text or "secplus" in text or "security plus" in text or "sy0" in text:
        return "secplus"
    if "cissp" in text:
        return "cissp"
    if "ceh" in text or "ethical hack" in text:
        return "ceh"
    return None


def fold(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    return "".join(char for char in normalized if not unicodedata.combining(char))


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for token in _TOKEN.findall(fold(text)):
        if token in STOPWORDS or len(token) < 2:
            continue
        tokens.append(token)
        translated = PT_EN_GLOSSARY.get(token)
        if translated:
            tokens.extend(translated.split())
    return tokens


@dataclass
class LinkQuestion:
    id: str
    certification: str | None
    prompt: str
    options: list[tuple[str, str]]  # (key, text)
    correct_keys: list[str]
    justification: str = ""
    domain: str | None = None
    module_code: str | None = None
    citations: list[dict] = field(default_factory=list)


@dataclass
class LinkResult:
    sections: list[tuple[str, float]]
    options: dict[str, tuple[str, float]]
    cited_section: str | None


class SectionIndex:
    """BM25 (k1=1.2, b=0.75) over the linkable sections of one certification."""

    def __init__(self, sections: list[CorpusSection]):
        self.sections = sections
        self.doc_tokens: list[Counter[str]] = []
        lengths: list[int] = []
        document_frequency: Counter[str] = Counter()
        for section in sections:
            title_tokens = tokenize(" ".join(section.path[-2:]))
            tokens = Counter(tokenize(section.text))
            for token in title_tokens:
                tokens[token] += 3  # headings are strong evidence
            self.doc_tokens.append(tokens)
            lengths.append(sum(tokens.values()))
            document_frequency.update(tokens.keys())
        self.avg_length = (sum(lengths) / len(lengths)) if lengths else 1.0
        self.lengths = lengths
        count = max(len(sections), 1)
        self.idf = {token: math.log(1 + (count - df + 0.5) / (df + 0.5)) for token, df in document_frequency.items()}
        self.postings: dict[str, list[int]] = defaultdict(list)
        for index, tokens in enumerate(self.doc_tokens):
            for token in tokens:
                self.postings[token].append(index)

    def score(self, query: Counter[str]) -> dict[int, float]:
        scores: dict[int, float] = defaultdict(float)
        for token, weight in query.items():
            idf = self.idf.get(token)
            if not idf:
                continue
            for index in self.postings[token]:
                tf = self.doc_tokens[index][token]
                norm = tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * self.lengths[index] / self.avg_length))
                scores[index] += weight * idf * norm
        return scores


def _query(*weighted_texts: tuple[str, float]) -> Counter[str]:
    query: Counter[str] = Counter()
    for text, weight in weighted_texts:
        for token in tokenize(text):
            query[token] += weight
    return query


OPTION_TITLE_OVERLAP = 0.5

# Too generic to identify a concept in a heading.
GENERIC_TOKENS = frozenset(
    """security secure system systems data information management process processes policy policies control controls
    implement implementing implementation use using ensure organization organizational regular regularly all only new
    based level levels type types method methods approach program team plan user users service services access
    network networks application applications software hardware technical physical company business attack attacks
    technique techniques tool tools solution solutions strategy strategies""".split()
)


def _concept_tokens(option_text: str) -> set[str]:
    tokens = set(tokenize(option_text)) - GENERIC_TOKENS
    return {token for token in tokens if len(token) >= 3 or token.isupper()}


def _english_hints(text: str) -> str:
    return " ".join(_PARENTHESIZED.findall(text or ""))


def _question_domain(question: LinkQuestion) -> int | None:
    name = fold(question.domain or "").strip()
    if not name:
        return None
    if certification_key(question.certification) == "cissp" and name in CISSP_DOMAIN_OVERRIDES:
        return CISSP_DOMAIN_OVERRIDES[name]
    return DOMAIN_NUMBERS.get(name)


class QuestionLinker:
    def __init__(self, corpus: MaterialCorpus):
        self.corpus = corpus
        groups: dict[str, list[CorpusSection]] = defaultdict(list)
        for section in corpus.linkable():
            key = certification_key(section.certification)
            if key:
                groups[key].append(section)
        self.indexes = {key: SectionIndex(sections) for key, sections in groups.items()}

    def _cited_section(self, question: LinkQuestion) -> CorpusSection | None:
        for citation in question.citations:
            section = self.corpus.resolve_locator(citation.get("material_path"), citation.get("locator"))
            if section is not None:
                return section
        return None

    def _subtree(self, section: CorpusSection | None) -> set[str]:
        if section is None:
            return set()
        seen: set[str] = set()
        pending = [section.id]
        while pending:
            current = pending.pop()
            if current in seen:
                continue
            seen.add(current)
            node = self.corpus.get(current)
            if node is not None:
                pending.extend(node.child_ids)
        return seen

    def _prior(self, section: CorpusSection, domain: int | None, module: str | None, cited: CorpusSection | None, subtree: set[str]) -> float:
        prior = 1.0
        if section.id in subtree:
            prior *= 1.3
        elif cited is not None and section.book_slug == cited.book_slug and section.chapter_file == cited.chapter_file:
            prior *= 1.2
        if module:
            prior *= 1.5 if module in section.modules else 0.75
        elif domain and section.domains:
            prior *= 1.3 if domain in section.domains else 0.8
        if section.kind == "summary":
            prior *= 0.7
        return prior

    def _rank(self, index: SectionIndex, query: Counter[str], priors) -> list[tuple[CorpusSection, float]]:
        raw = index.score(query)
        ranked = [(index.sections[position], score * priors(index.sections[position])) for position, score in raw.items()]
        ranked.sort(key=lambda item: item[1], reverse=True)
        return ranked

    def link(self, question: LinkQuestion, *, max_sections: int = 3) -> LinkResult | None:
        key = certification_key(question.certification)
        index = self.indexes.get(key or "")
        if index is None:
            return None
        cited = self._cited_section(question)
        subtree = self._subtree(cited)
        domain = _question_domain(question)
        module = (question.module_code or "").upper() or None

        def priors(section: CorpusSection) -> float:
            return self._prior(section, domain, module, cited, subtree)

        option_text = dict(question.options)
        correct_text = " ".join(option_text.get(option_key, "") for option_key in question.correct_keys)
        match_terms = " ".join(
            " ".join(str(term) for term in citation.get("match_terms") or []) for citation in question.citations
        )
        justification = " ".join(str(question.justification or "").split()[:120])
        query = _query(
            (question.prompt, 1.0),
            (correct_text, 2.0),
            (_english_hints(question.prompt + " " + correct_text), 2.0),
            (justification, 1.0),
            (match_terms, 0.5),
        )
        ranked = self._rank(index, query, priors)

        chosen: list[tuple[str, float]] = []
        per_book: Counter[str] = Counter()
        for section, score in ranked:
            if per_book[section.book_slug] >= 2:
                continue
            chosen.append((section.id, round(score, 3)))
            per_book[section.book_slug] += 1
            if len(chosen) >= max_sections:
                break

        options: dict[str, tuple[str, float]] = {}
        for option_key, text in question.options:
            if option_key in question.correct_keys or not text.strip():
                continue
            concept = _concept_tokens(text)
            if not concept:
                continue
            option_query = _query((text, 3.0), (_english_hints(text), 3.0), (question.prompt, 0.5))
            # Precision over recall: a distractor only gets a section whose heading names the
            # concept (e.g. "SIEM" → "SIEM Systems"); otherwise no link beats a wrong one.
            for section, score in self._rank(index, option_query, priors)[:40]:
                heading = set(tokenize(section.title))
                if len(concept & heading) / len(concept) >= OPTION_TITLE_OVERLAP:
                    options[option_key] = (section.id, round(score, 3))
                    break

        return LinkResult(sections=chosen, options=options, cited_section=cited.id if cited else None)
