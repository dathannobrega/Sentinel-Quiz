"""LLM providers for AI authoring (PLANO §12.1, §12.7).

``LLMProvider.generate_json(task, system, user, *, model)`` returns ``(dict, usage)``.

- ``GeminiProvider``: REST ``generateContent`` in JSON mode, bounded retries with
  jitter on 429/5xx/network, and a per-process circuit breaker (5 failures in 60 s open
  the circuit for 120 s) so an outage fails fast into the degraded path.
- ``FakeProvider``: deterministic output built from a small curated fact set; used in
  development and tests (production refuses it, see Settings.runtime_problems).
"""
from __future__ import annotations

import json
import logging
import random
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from app.core.config import settings
from app.services.gemini import GEMINI_BASE_URL, _extract_best_text_and_meta

logger = logging.getLogger("app.ai_authoring.provider")


class ProviderError(Exception):
    """Upstream unavailable or unusable answer (retries exhausted)."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


@dataclass
class Usage:
    tokens_in: int = 0
    tokens_out: int = 0


class LLMProvider(Protocol):
    name: str

    def generate_json(self, task: str, system: str, user: str, *, model: str) -> tuple[dict, Usage]: ...


def _parse_json(text: str) -> dict:
    text = (text or "").strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
    if fenced:
        text = fenced.group(1)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ProviderError("invalid_json", "The model did not return JSON.") from None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            raise ProviderError("invalid_json", "The model did not return JSON.") from None
    if not isinstance(data, dict):
        raise ProviderError("invalid_json", "The model returned an unexpected JSON value.")
    return data


# ----------------------------------------------------------------------------- Gemini

class _CircuitBreaker:
    def __init__(self, threshold: int = 5, window_s: float = 60.0, cooldown_s: float = 120.0) -> None:
        self.threshold, self.window_s, self.cooldown_s = threshold, window_s, cooldown_s
        self._failures: list[float] = []
        self._open_until = 0.0
        self._lock = threading.Lock()

    def check(self) -> None:
        with self._lock:
            if time.monotonic() < self._open_until:
                raise ProviderError("circuit_open", "AI provider temporarily unavailable.")

    def success(self) -> None:
        with self._lock:
            self._failures.clear()

    def failure(self) -> None:
        now = time.monotonic()
        with self._lock:
            self._failures = [t for t in self._failures if now - t < self.window_s] + [now]
            if len(self._failures) >= self.threshold:
                self._open_until = now + self.cooldown_s
                self._failures.clear()
                logger.warning("AI provider circuit opened", extra={"event": "ai_circuit_open"})


_BREAKER = _CircuitBreaker()
RETRYABLE = {429, 500, 502, 503, 504}


class GeminiProvider:
    name = "gemini"

    def __init__(self, *, max_retries: int = 2) -> None:
        self.max_retries = max_retries

    def generate_json(self, task: str, system: str, user: str, *, model: str) -> tuple[dict, Usage]:
        api_key = settings.gemini_api_key.strip()
        if not api_key:
            raise ProviderError("not_configured", "GEMINI_API_KEY is not configured.")
        _BREAKER.check()
        payload: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": 0.0 if task == "critic" else 0.4,
                "maxOutputTokens": int(settings.ai_authoring_max_output_tokens),
                "responseMimeType": "application/json",
                "candidateCount": 1,
            },
        }
        if "2.5" in model and "flash" in model:
            payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
        timeout = httpx.Timeout(settings.ai_authoring_timeout_seconds, connect=5.0)
        url = f"{GEMINI_BASE_URL}/models/{model}:generateContent"
        last_error = "unavailable"
        for attempt in range(self.max_retries + 1):
            if attempt:
                time.sleep(min(8.0, (2 ** attempt) * 0.5) * random.uniform(0.5, 1.0))
            try:
                with httpx.Client(timeout=timeout) as client:
                    response = client.post(url, headers={"x-goog-api-key": api_key}, json=payload)
            except httpx.HTTPError as exc:
                last_error = f"network:{type(exc).__name__}"
                _BREAKER.failure()
                continue
            if response.status_code in RETRYABLE:
                last_error = f"http_{response.status_code}"
                _BREAKER.failure()
                continue
            if response.status_code != 200:
                _BREAKER.failure()
                raise ProviderError(f"http_{response.status_code}", "AI provider rejected the request.")
            try:
                text, meta = _extract_best_text_and_meta(response.json())
            except (ValueError, AttributeError, TypeError):
                _BREAKER.failure()
                raise ProviderError("invalid_response", "AI provider returned an invalid response.") from None
            _BREAKER.success()
            usage_meta = meta.get("usageMetadata") or {}
            usage = Usage(int(usage_meta.get("promptTokenCount") or 0), int(usage_meta.get("candidatesTokenCount") or 0))
            if meta.get("finishReason") == "MAX_TOKENS":
                logger.warning("AI output truncated", extra={"event": "ai_output_truncated", "task": task})
            return _parse_json(text), usage
        raise ProviderError("unavailable", f"AI provider unavailable ({last_error}).")


# ----------------------------------------------------------------------------- Fake

@dataclass(frozen=True)
class _Fact:
    domain: str
    pt: str
    en: str
    correct: tuple[str, ...]
    wrong: tuple[str, ...]
    answer: str
    why: str


_FACTS: tuple[_Fact, ...] = (
    _Fact("Threats, Vulnerabilities and Mitigations", "Qual controle mais reduz o sucesso de ataques de phishing?",
          "Which control most reduces the success of phishing attacks?",
          ("Treinamento de conscientização",), ("Relay SMTP aberto", "Desativar o MFA", "Senhas compartilhadas"),
          "treinamento", "Usuários treinados reconhecem e reportam mensagens suspeitas."),
    _Fact("General Security Concepts", "Qual princípio garante que um usuário receba apenas o acesso necessário?",
          "Which principle ensures users only get the access they need?",
          ("Privilégio mínimo",), ("Defesa em profundidade", "Segurança por obscuridade", "Separação de ambientes"),
          "privilegio minimo", "O privilégio mínimo limita o impacto de contas comprometidas."),
    _Fact("Security Architecture", "Qual tecnologia isola segmentos de rede no nível 2?",
          "Which technology isolates network segments at layer 2?",
          ("VLAN",), ("NAT", "DNSSEC", "SNMP"), "vlan", "VLANs separam domínios de broadcast na camada 2."),
    _Fact("Security Operations", "Qual fase da resposta a incidentes vem logo após a detecção e análise?",
          "Which incident response phase comes right after detection and analysis?",
          ("Contenção",), ("Lições aprendidas", "Preparação", "Erradicação"),
          "contencao", "Contém-se o incidente antes de erradicar a causa."),
    _Fact("Security Program Management and Oversight", "Qual documento define o nível mínimo de serviço acordado com um fornecedor?",
          "Which document defines the minimum service level agreed with a vendor?",
          ("SLA",), ("NDA", "MOU", "BPA"), "sla", "O SLA fixa métricas e níveis de serviço exigíveis."),
    _Fact("General Security Concepts", "Quais são fatores de autenticação distintos?",
          "Which of these are distinct authentication factors?",
          ("Algo que você sabe (senha)", "Algo que você tem (token)"), ("Algo que você gosta", "Algo que você vê"),
          "senha", "Conhecimento, posse e inerência são categorias distintas de fatores."),
    _Fact("Threats, Vulnerabilities and Mitigations", "Como se chama o phishing feito por SMS?",
          "What is phishing over SMS called?", ("Smishing",), ("Vishing", "Pharming", "Whaling"),
          "smishing", "Smishing combina SMS e phishing."),
    _Fact("Security Architecture", "Qual algoritmo é de criptografia simétrica?",
          "Which algorithm is symmetric encryption?", ("AES",), ("RSA", "ECDSA", "Diffie-Hellman"),
          "aes", "AES usa a mesma chave para cifrar e decifrar."),
    _Fact("Security Operations", "Qual ferramenta correlaciona eventos de várias fontes de log?",
          "Which tool correlates events from many log sources?", ("SIEM",), ("DLP", "WAF", "NAC"),
          "siem", "O SIEM agrega e correlaciona logs para detectar ameaças."),
    _Fact("Security Program Management and Oversight", "Quais são medidas típicas de gestão de risco?",
          "Which are typical risk treatment options?",
          ("Mitigar o risco", "Transferir o risco"), ("Ignorar o registro de riscos", "Esconder o risco"),
          "mitigar", "Tratamentos de risco: mitigar, transferir, aceitar ou evitar."),
)


def _fact_for_prompt(prompt: str) -> _Fact | None:
    for fact in _FACTS:
        if prompt.startswith(fact.pt) or prompt.startswith(fact.en) or fact.pt in prompt or fact.en in prompt:
            return fact
    return None


class FakeProvider:
    """Deterministic provider for development and tests."""

    name = "fake"

    def generate_json(self, task: str, system: str, user: str, *, model: str) -> tuple[dict, Usage]:
        request = self._request(user)
        if task == "generate":
            return self._generate(request), Usage(len(user) // 4, 1200)
        if task == "critic":
            return self._critic(request), Usage(len(user) // 4, 200)
        if task == "improve":
            return self._improve(request), Usage(len(user) // 4, 300)
        raise ProviderError("invalid_task", task)

    @staticmethod
    def _request(user: str) -> dict:
        match = re.search(r"<request_json>(.*?)</request_json>", user, re.S)
        return json.loads(match.group(1)) if match else {}

    def _generate(self, request: dict) -> dict:
        n = int(request.get("n") or 3)
        types = request.get("types") or ["single_choice"]
        english = str(request.get("language") or "").startswith("en")
        domains = set(request.get("domains") or [])
        facts = [f for f in _FACTS if not domains or f.domain in domains] or list(_FACTS)
        items = []
        for index, fact in enumerate(facts[:n]):
            wanted = types[index % len(types)]
            multi = len(fact.correct) > 1
            item_type = "multi_choice" if multi and "multi_choice" in types else ("single_choice" if multi else wanted)
            if multi and item_type != "multi_choice":
                continue
            prompt = fact.en if english else fact.pt
            if item_type == "true_false":
                items.append({
                    "type": "true_false", "prompt": f"{fact.correct[0]}: {prompt}",
                    "options": [{"key": "A", "text": "Verdadeiro"}, {"key": "B", "text": "Falso", "why_wrong": "É verdadeiro."}],
                    "correct_keys": ["A"], "rationale": fact.why, "domain": fact.domain, "difficulty": "Easy",
                })
                continue
            if item_type == "type_answer":
                items.append({
                    "type": "type_answer", "prompt": prompt, "accepted_answers": [fact.correct[0], fact.answer],
                    "rationale": fact.why, "domain": fact.domain, "difficulty": "Medium", "time_limit_s": 25,
                })
                continue
            texts = list(fact.correct) + list(fact.wrong)
            options = [
                {"key": "ABCDEF"[i], "text": text, **({} if text in fact.correct else {"why_wrong": "Não atende ao enunciado."})}
                for i, text in enumerate(texts)
            ]
            items.append({
                "type": item_type, "prompt": prompt, "options": options,
                "correct_keys": ["ABCDEF"[i] for i, text in enumerate(texts) if text in fact.correct],
                "rationale": fact.why, "domain": fact.domain, "difficulty": "Medium",
            })
        return {"items": items}

    def _critic(self, request: dict) -> dict:
        answers = []
        for position, item in enumerate(request.get("items") or []):
            fact = _fact_for_prompt(str(item.get("prompt") or ""))
            options = item.get("options") or []
            solved = [o["key"] for o in options if fact and o.get("text") in fact.correct]
            # Every 4th item disagrees, so the review UI always has a flag to exercise.
            if position % 4 == 3 and options:
                solved = [options[-1]["key"]]
            answers.append({"index": item.get("index", position), "solved_keys": solved, "confidence": 0.62 if position % 4 == 3 else 0.93,
                            "defensible_keys": solved, "factual_issues": []})
        return {"answers": answers}

    def _improve(self, request: dict) -> dict:
        action = request.get("action")
        item = request.get("item") or {}
        if action == "rewrite":
            return {"prompt": f"{str(item.get('prompt') or '').rstrip('?')} — qual é a melhor resposta?",
                    "options": [{"key": o["key"], "text": o["text"]} for o in item.get("options") or []]}
        if action == "distractors":
            options = []
            for o in item.get("options") or []:
                options.append({"key": o["key"], "text": o["text"] if o.get("correct") else f"{o['text']} (alternativa revisada)"})
            return {"options": options}
        return {"explanation": f"A resposta correta atende diretamente ao que o enunciado pede: {item.get('prompt', '')}"}


def get_provider() -> LLMProvider:
    if str(settings.ai_provider or "").strip().lower() == "fake":
        return FakeProvider()
    return GeminiProvider()
