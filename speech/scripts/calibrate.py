"""Calibrate the read-aloud assessment against labelled cases (Sentinel Reader Inc. 2).

Talks to a running speech service over HTTP (native or Docker), so it measures exactly
what production does.

Synthetic mode (``--synthetic``): ~30 security sentences; for each one the *spoken*
text is a variant of the reference (exact, one word dropped, one word swapped for a
similar real word, one word inserted, one word replaced by a mispronounced respelling),
synthesized with the service's own TTS in several voices and assessed against the
reference. Known labels per reference word: ``ok``, ``missed`` (dropped),
``mispronounced`` (swapped or respelled).

Dataset mode (``--dataset DIR``): human-labelled recordings, ``DIR/<name>.wav|webm|...``
next to ``DIR/<name>.json`` = ``{"reference_text": "...", "labels": [{"index": 3,
"status": "mispronounced"}]}`` (unlisted words are ``ok``).

The report (Markdown) has per-status precision/recall/F1, the confusion matrix, mean
scores per variant and sweeps of SPEECH_PHONEME_WORD_THRESHOLD and of the ASR weak
confidence computed offline from the per-word ``phoneme_score``/``confidence``.

    uv run python scripts/calibrate.py --synthetic --base-url http://127.0.0.1:8100 --out report.md
    uv run python scripts/calibrate.py --dataset ./labelled --token "$SPEECH_API_TOKEN"
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import Counter, defaultdict
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from speech.textnorm import display_tokens  # noqa: E402

STATUSES = ["ok", "weak", "mispronounced", "missed"]
GOLD = ["ok", "mispronounced", "missed"]
AUDIO_EXTS = (".wav", ".webm", ".ogg", ".mp3", ".m4a", ".mp4", ".flac")
INSERT_WORD = "really"

# (reference, (word, similar real word), (word, mispronounced respelling))
SENTENCES: list[tuple[str, tuple[str, str], tuple[str, str]]] = [
    ("Security awareness training teaches employees to recognize phishing emails.", ("training", "draining"), ("Security", "Sekyoority")),
    ("Multi-factor authentication adds a second layer of protection to every account.", ("layer", "player"), ("authentication", "otentikayshun")),
    ("The firewall blocks unauthorized traffic from the public internet.", ("blocks", "locks"), ("firewall", "fyerwool")),
    ("Encryption protects the confidentiality of sensitive data at rest.", ("rest", "test"), ("Encryption", "Enkripshun")),
    ("An attacker may exploit a vulnerability in the web server.", ("server", "service"), ("vulnerability", "wulnerabeelity")),
    ("Every threat must be reported to the security team immediately.", ("threat", "treat"), ("threat", "tret")),
    ("Strong passwords should contain letters, numbers and symbols.", ("Strong", "Wrong"), ("symbols", "seembols")),
    ("The breach exposed thousands of customer records last year.", ("breach", "beach"), ("thousands", "tousands")),
    ("Install the latest patch to fix the critical flaw.", ("patch", "batch"), ("critical", "creetical")),
    ("Ransomware encrypts files and demands payment for the key.", ("key", "tea"), ("encrypts", "enkreeps")),
    ("Least privilege limits what each user is allowed to do.", ("limits", "lemons"), ("privilege", "preevilej")),
    ("Backups must be tested regularly to ensure recovery works.", ("tested", "rested"), ("recovery", "reecovairy")),
    ("A denial of service attack floods the network with traffic.", ("floods", "floats"), ("traffic", "trafeek")),
    ("Social engineering tricks people into revealing their credentials.", ("tricks", "trucks"), ("credentials", "credenshals")),
    ("The incident response plan defines who does what during an attack.", ("plan", "plant"), ("incident", "eensident")),
    ("Access control lists decide which hosts can reach the database.", ("hosts", "ghosts"), ("database", "dahtabahs")),
    ("Malware often hides inside attachments that look harmless.", ("hides", "rides"), ("attachments", "atachmense")),
    ("Logs help analysts reconstruct the timeline of an intrusion.", ("Logs", "Dogs"), ("analysts", "analeests")),
    ("A virtual private network encrypts traffic over untrusted links.", ("private", "pirate"), ("virtual", "wirtual")),
    ("Patch management reduces the window of exposure to new exploits.", ("window", "widow"), ("exposure", "exposher")),
    ("Two people must approve every change to production systems.", ("change", "chance"), ("approve", "aproof")),
    ("The auditor checked whether the controls were working as designed.", ("checked", "chucked"), ("whether", "wedder")),
    ("Phishing messages often create a false sense of urgency.", ("false", "falls"), ("urgency", "urgensee")),
    ("Hashing turns a password into a fixed length digest.", ("fixed", "mixed"), ("digest", "dyjest")),
    ("Zero trust assumes that no device is safe by default.", ("safe", "save"), ("device", "deweece")),
    ("Security cameras deter thieves and record suspicious activity.", ("deter", "defer"), ("thieves", "teeves")),
    ("Certificates prove the identity of a website to the browser.", ("browser", "trouser"), ("identity", "eyedentitee")),
    ("Cloud providers share responsibility for security with their customers.", ("share", "shame"), ("responsibility", "responsabeelity")),
    ("Intrusion detection systems alert analysts to unusual behavior.", ("alert", "allot"), ("behavior", "beheyvyor")),
    ("Disable unused services to reduce the attack surface of a server.", ("reduce", "produce"), ("surface", "serfiss")),
]
VARIANTS = ["exact", "drop", "substitute", "insert", "respell"]


@dataclass
class Case:
    name: str
    variant: str
    reference: str
    spoken: str | None  # None in dataset mode
    labels: dict[int, str]
    voice: str | None = None
    audio_path: Path | None = None
    target: int | None = None  # the reference word the variant changed
    result: dict[str, Any] | None = None
    error: str | None = None
    seconds: float = 0.0


@dataclass
class Report:
    cases: list[Case]
    meta: dict[str, Any] = field(default_factory=dict)


# ------------------------------------------------------------------- case building
def _find(tokens: list, word: str) -> int:
    for i, tok in enumerate(tokens):
        if tok.text.lower() == word.lower():
            return i
    raise ValueError(f"{word!r} not in sentence")


def _replace(text: str, tok: Any, new: str) -> str:
    return text[: tok.char_start] + new + text[tok.char_end :]


def synthetic_cases(voices: list[str], limit: int | None, variants: list[str]) -> list[Case]:
    cases: list[Case] = []
    for n, (ref, (sub_word, sub_new), (resp_word, resp_new)) in enumerate(SENTENCES[: limit or None]):
        tokens = display_tokens(ref)
        ok = {i: "ok" for i in range(len(tokens))}
        sub_i, resp_i = _find(tokens, sub_word), _find(tokens, resp_word)
        drop_i = len(tokens) // 2
        while drop_i in (sub_i, resp_i):
            drop_i = (drop_i + 1) % len(tokens)
        ins_i = min(2, len(tokens) - 1)
        built = {
            "exact": (ref, ok, None),
            "drop": (
                (ref[: tokens[drop_i].char_start] + ref[tokens[drop_i].char_end :]).replace("  ", " "),
                {**ok, drop_i: "missed"}, drop_i,
            ),
            "substitute": (_replace(ref, tokens[sub_i], sub_new), {**ok, sub_i: "mispronounced"}, sub_i),
            "insert": (ref[: tokens[ins_i].char_end] + f" {INSERT_WORD}" + ref[tokens[ins_i].char_end :], ok, None),
            "respell": (_replace(ref, tokens[resp_i], resp_new), {**ok, resp_i: "mispronounced"}, resp_i),
        }
        for voice in voices:
            for variant in variants:
                spoken, labels, target = built[variant]
                cases.append(Case(f"s{n:02d}-{variant}-{voice}", variant, ref, spoken, dict(labels), voice=voice, target=target))
    return cases


def dataset_cases(directory: Path) -> list[Case]:
    cases = []
    for meta_path in sorted(directory.glob("*.json")):
        audio = next((meta_path.with_suffix(ext) for ext in AUDIO_EXTS if meta_path.with_suffix(ext).exists()), None)
        if audio is None:
            print(f"skip {meta_path.name}: no audio next to it", file=sys.stderr)
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        ref = meta["reference_text"]
        labels = {i: "ok" for i in range(len(display_tokens(ref)))}
        for item in meta.get("labels", []):
            labels[int(item["index"])] = str(item["status"])
        cases.append(Case(meta_path.stem, str(meta.get("variant", "dataset")), ref, None, labels, audio_path=audio))
    return cases


# ------------------------------------------------------------------------- HTTP
class Client:
    def __init__(self, base_url: str, token: str | None, timeout: float = 300.0) -> None:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.http = httpx.Client(base_url=base_url.rstrip("/"), headers=headers, timeout=timeout)

    def health(self) -> dict:
        return self.http.get("/healthz").json()

    def synthesize(self, text: str, voice: str, speed: float) -> tuple[bytes, str]:
        res = self.http.post("/v1/tts", json={"text": text, "voice": voice, "speed": speed, "lang": "en-us"})
        res.raise_for_status()
        body = res.json()
        audio = self.http.get(f"/v1/audio/{body['audio_id']}")
        audio.raise_for_status()
        return audio.content, body["content_type"]

    def assess(self, audio: bytes, content_type: str, reference: str) -> dict:
        ext = {"audio/mpeg": "mp3", "audio/wav": "wav"}.get(content_type, "bin")
        res = self.http.post(
            "/v1/assess", files={"audio": (f"clip.{ext}", audio, content_type)}, data={"reference_text": reference, "lang": "en"}
        )
        res.raise_for_status()
        return res.json()


def run_case(client: Client, case: Case, speed: float) -> Case:
    start = time.perf_counter()
    try:
        if case.audio_path is not None:
            content_type = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".webm": "audio/webm"}.get(case.audio_path.suffix, "application/octet-stream")
            audio = case.audio_path.read_bytes()
        else:
            audio, content_type = client.synthesize(case.spoken or case.reference, case.voice or "af_heart", speed)
        t0 = time.perf_counter()
        case.result = client.assess(audio, content_type, case.reference)
        case.seconds = time.perf_counter() - t0
    except Exception as exc:  # noqa: BLE001
        case.error = f"{type(exc).__name__}: {exc}"
        case.seconds = time.perf_counter() - start
    return case


# --------------------------------------------------------------------- metrics
def prf(confusion: dict[str, Counter], status: str) -> tuple[float | None, float | None, float | None, int]:
    tp = confusion[status][status]
    predicted = sum(confusion[g][status] for g in confusion)
    support = sum(confusion[status].values())
    p = tp / predicted if predicted else None
    r = tp / support if support else None
    f = 2 * p * r / (p + r) if p and r else (0.0 if p is not None and r is not None else None)
    return p, r, f, support


def words_of(cases: Iterable[Case]) -> list[tuple[Case, str, dict]]:
    out = []
    for case in cases:
        if not case.result:
            continue
        for word in case.result["words"]:
            out.append((case, case.labels.get(word["index"], "ok"), word))
    return out


def simulate_status(word: dict, phoneme_threshold: float | None, weak_conf: float | None) -> str:
    """Status the service would give with other thresholds (offline what-if)."""
    status, reason = word["status"], word.get("reason")
    if status == "missed":
        return "missed"
    if reason == "substitution":
        return "mispronounced"
    base = status
    if reason == "phoneme":  # undo the override: ok or weak by confidence
        base = "ok"
        if word.get("confidence") is not None and weak_conf is not None and word["confidence"] < weak_conf:
            base = "weak"
    elif weak_conf is not None and reason in (None, "low_confidence") and word.get("confidence") is not None:
        base = "weak" if word["confidence"] < weak_conf else "ok"
    if phoneme_threshold is not None and word.get("phoneme_score") is not None and word["phoneme_score"] < phoneme_threshold:
        return "mispronounced"
    return base


def fmt(x: float | None, digits: int = 3) -> str:
    return "—" if x is None else f"{x:.{digits}f}"


def confusion_table(pairs: Iterable[tuple[str, str]]) -> tuple[dict[str, Counter], list[str]]:
    confusion: dict[str, Counter] = defaultdict(Counter)
    for gold, pred in pairs:
        confusion[gold][pred] += 1
    return confusion, [g for g in GOLD if g in confusion] + sorted(set(confusion) - set(GOLD))


def render(report: Report) -> str:
    cases = report.cases
    done = [c for c in cases if c.result]
    failed = [c for c in cases if c.error]
    lines: list[str] = []
    m = report.meta
    lines += [
        "## Configuração", "",
        f"- Servidor: `{m.get('base_url')}`; engines: TTS `{m.get('tts')}`, ASR `{m.get('asr')}`, fonemas `{m.get('phoneme')}`",
        f"- Modo: {m.get('mode')}; casos: {len(cases)} ({len(done)} avaliados, {len(failed)} com erro); vozes: {', '.join(m.get('voices') or []) or '—'}",
        f"- Tempo total: {m.get('elapsed', 0):.0f} s; assess médio {fmt(statistics.mean(c.seconds for c in done) if done else None, 2)} s",
        "",
    ]
    all_words = words_of(done)
    confusion, rows = confusion_table((gold, w["status"]) for _c, gold, w in all_words)
    lines += ["## Matriz de confusão (rótulo × status do serviço)", "", "| rótulo \\ previsto | " + " | ".join(STATUSES) + " | total |", "|---|" + "---:|" * (len(STATUSES) + 1)]
    for gold in rows:
        lines.append(f"| **{gold}** | " + " | ".join(str(confusion[gold][s]) for s in STATUSES) + f" | {sum(confusion[gold].values())} |")
    lines += ["", "## Precisão / revocação / F1 por status", "", "| status | precisão | revocação | F1 | suporte |", "|---|---:|---:|---:|---:|"]
    for status in GOLD:
        p, r, f, support = prf(confusion, status)
        lines.append(f"| {status} | {fmt(p)} | {fmt(r)} | {fmt(f)} | {support} |")
    weak_ok = confusion["ok"]["weak"]
    lines += ["", f"`weak` não tem rótulo próprio: {weak_ok} palavras corretas saíram `weak` "
              f"({fmt(weak_ok / max(1, sum(confusion['ok'].values())) * 100, 1)}% das corretas).", ""]

    # Problem detection (binary): a learner cares whether a wrong word was flagged.
    lines += ["## Detecção de erro (binária)", "", "Positivo = rótulo `mispronounced`/`missed`; previsto positivo = status `mispronounced`/`missed` (com e sem `weak`).", "",
              "| critério | precisão | revocação | F1 |", "|---|---:|---:|---:|"]
    for label, positive in (("mispronounced+missed", {"mispronounced", "missed"}), ("+ weak", {"mispronounced", "missed", "weak"})):
        tp = sum(1 for _c, g, w in all_words if g != "ok" and w["status"] in positive)
        fp = sum(1 for _c, g, w in all_words if g == "ok" and w["status"] in positive)
        fn = sum(1 for _c, g, w in all_words if g != "ok" and w["status"] not in positive)
        p = tp / (tp + fp) if tp + fp else None
        r = tp / (tp + fn) if tp + fn else None
        f = 2 * p * r / (p + r) if p and r else None
        lines.append(f"| {label} | {fmt(p)} | {fmt(r)} | {fmt(f)} |")

    # Per variant
    lines += ["", "## Por variante", "", "| variante | casos | overall médio | accuracy média | alvo detectado | como (reason) | extras = 1 |", "|---|---:|---:|---:|---:|---|---:|"]
    by_variant: dict[str, list[Case]] = defaultdict(list)
    for c in done:
        by_variant[c.variant].append(c)
    for variant in VARIANTS + sorted(set(by_variant) - set(VARIANTS)):
        group = by_variant.get(variant)
        if not group:
            continue
        overall = statistics.mean(c.result["scores"]["overall"] for c in group)  # type: ignore[index]
        accuracy = statistics.mean(c.result["scores"]["accuracy"] for c in group)  # type: ignore[index]
        detected, reasons = "—", "—"
        targets = [c for c in group if c.target is not None]
        if targets:
            hits = Counter()
            for c in targets:
                w = c.result["words"][c.target]  # type: ignore[index]
                expected = c.labels[c.target]  # type: ignore[index]
                if w["status"] == expected:
                    hits[w.get("reason") or w["status"]] += 1
                else:
                    hits[f"não ({w['status']})"] += 1
            ok_hits = sum(v for k, v in hits.items() if not k.startswith("não"))
            detected = f"{ok_hits}/{len(targets)}"
            reasons = ", ".join(f"{k} {v}" for k, v in hits.most_common())
        extras = sum(1 for c in group if len(c.result["extras"]) == 1)  # type: ignore[index]
        lines.append(f"| {variant} | {len(group)} | {overall:.3f} | {accuracy:.3f} | {detected} | {reasons} | {extras}/{len(group)} |")

    # Threshold sweeps
    has_phonemes = any(w.get("phoneme_score") is not None for _c, _g, w in all_words)
    if has_phonemes:
        lines += ["", "## Varredura de `SPEECH_PHONEME_WORD_THRESHOLD` (simulada)", "",
                  "Mesmas avaliações, status recalculado offline a partir de `phoneme_score`. `0` = sem rebaixamento por fonema (equivale a desligar a engine para o status).", "",
                  "| limiar | P(mispronounced) | R(mispronounced) | F1 | corretas marcadas mispronounced | respelling detectado |", "|---:|---:|---:|---:|---:|---:|"]
        respell = [(c, c.result["words"][c.target]) for c in done if c.variant == "respell" and c.target is not None]  # type: ignore[index]
        for t in (0.0, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9):
            conf, _ = confusion_table((g, simulate_status(w, t, None)) for _c, g, w in all_words)
            p, r, f, _s = prf(conf, "mispronounced")
            fp_ok = conf["ok"]["mispronounced"] / max(1, sum(conf["ok"].values()))
            hit = sum(1 for _c, w in respell if simulate_status(w, t, None) == "mispronounced")
            lines.append(f"| {t:.2f} | {fmt(p)} | {fmt(r)} | {fmt(f)} | {fp_ok * 100:.1f}% | {hit}/{len(respell)} |")
        ok_scores = sorted(w["phoneme_score"] for _c, g, w in all_words if g == "ok" and w.get("phoneme_score") is not None)
        bad_scores = sorted(w["phoneme_score"] for c, g, w in all_words if g == "mispronounced" and w.get("phoneme_score") is not None)

        def pct(values: list[float], q: float) -> str:
            return fmt(values[min(len(values) - 1, int(q * len(values)))] if values else None, 2)

        lines += ["", "Distribuição de `phoneme_score`:", "", "| grupo | n | p05 | p10 | p25 | mediana | média |", "|---|---:|---:|---:|---:|---:|---:|"]
        for label, values in (("palavras corretas", ok_scores), ("palavras erradas (troca/respelling)", bad_scores)):
            mean = fmt(statistics.mean(values) if values else None, 2)
            lines.append(f"| {label} | {len(values)} | {pct(values, .05)} | {pct(values, .10)} | {pct(values, .25)} | {pct(values, .5)} | {mean} |")

    lines += ["", "## Varredura da confiança para `weak` (simulada)", "", "| confiança mínima | corretas → weak | erradas com confiança abaixo |", "|---:|---:|---:|"]
    for c_min in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
        ok_words = [w for _c, g, w in all_words if g == "ok" and w["status"] != "missed" and w.get("confidence") is not None]
        bad_words = [w for _c, g, w in all_words if g == "mispronounced" and w.get("confidence") is not None]
        weak_rate = sum(1 for w in ok_words if w["confidence"] < c_min) / max(1, len(ok_words))
        bad_rate = sum(1 for w in bad_words if w["confidence"] < c_min) / max(1, len(bad_words))
        lines.append(f"| {c_min:.1f} | {weak_rate * 100:.1f}% | {bad_rate * 100:.1f}% |")

    # Examples where Whisper accepted the word but the phonemes did not.
    examples = [(c, w) for c, g, w in all_words if w.get("reason") == "phoneme"]
    if examples:
        lines += ["", "## Exemplos: Whisper aceitou, fonemas rejeitaram", "", "| caso | palavra | ouvido (ASR) | phoneme_score | esperado | ouvido (fonemas) | rótulo |", "|---|---|---|---:|---|---|---|"]
        for c, w in examples[:15]:
            lines.append(f"| {c.name} | {w['text']} | {w['heard']} | {fmt(w['phoneme_score'], 2)} | `{w['expected_ipa']}` | `{w['heard_ipa']}` | {c.labels.get(w['index'], 'ok')} |")
    misses = [(c, gold, w) for c, gold, w in all_words if gold == "ok" and w["status"] in {"mispronounced", "missed"}]
    if misses:
        lines += ["", "## Falsos positivos (palavra correta marcada como erro)", "", "| caso | palavra | status | reason | ouvido | phoneme_score |", "|---|---|---|---|---|---:|"]
        for c, _g, w in misses[:25]:
            lines.append(f"| {c.name} | {w['text']} | {w['status']} | {w.get('reason') or '—'} | {w['heard'] or '—'} | {fmt(w.get('phoneme_score'), 2)} |")
        if len(misses) > 25:
            lines.append(f"| … | +{len(misses) - 25} | | | | |")
    if failed:
        lines += ["", "## Erros", ""] + [f"- {c.name}: {c.error}" for c in failed[:20]]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--synthetic", action="store_true", help="TTS-generated cases with known labels")
    mode.add_argument("--dataset", type=Path, help="directory with labelled recordings (*.wav|webm + *.json)")
    parser.add_argument("--base-url", default="http://127.0.0.1:8100")
    parser.add_argument("--token", default=None, help="SPEECH_API_TOKEN, when the service requires it")
    parser.add_argument("--voices", default="af_heart,am_michael,bf_emma")
    parser.add_argument("--variants", default=",".join(VARIANTS))
    parser.add_argument("--limit", type=int, default=None, help="only the first N sentences")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--workers", type=int, default=2, help="parallel requests (the service has 2 slots per engine)")
    parser.add_argument("--out", type=Path, default=None, help="Markdown report path (default: stdout)")
    parser.add_argument("--dump", type=Path, default=None, help="also write raw per-case JSON here")
    args = parser.parse_args(argv)

    client = Client(args.base_url, args.token)
    health = client.health()
    if health.get("status") != "ok":
        print(f"service not ready: {health.get('status')}", file=sys.stderr)
        return 2
    voices = [v.strip() for v in args.voices.split(",") if v.strip()]
    if args.synthetic:
        cases = synthetic_cases(voices, args.limit, [v for v in args.variants.split(",") if v])
    else:
        cases = dataset_cases(args.dataset)
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for i, case in enumerate(pool.map(lambda c: run_case(client, c, args.speed), cases), 1):
            if i % 25 == 0 or i == len(cases):
                print(f"{i}/{len(cases)} cases", file=sys.stderr)
    phoneme = next((c.result["engines"].get("phoneme") for c in cases if c.result), None)
    report = Report(cases, {
        "base_url": args.base_url, "mode": "sintético (TTS)" if args.synthetic else f"dataset {args.dataset}",
        "voices": voices if args.synthetic else [], "elapsed": time.perf_counter() - started,
        "tts": f"{health['tts']['engine']}/{health['tts']['model']}", "asr": f"{health['asr']['engine']}/{health['asr']['model']}",
        "phoneme": f"{health.get('phoneme', {}).get('engine')}/{health.get('phoneme', {}).get('model')}" if phoneme else "desligada",
    })
    text = render(report)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
        print(f"report written to {args.out}", file=sys.stderr)
    else:
        print(text)
    if args.dump:
        args.dump.write_text(json.dumps([
            {"name": c.name, "variant": c.variant, "voice": c.voice, "reference": c.reference, "spoken": c.spoken,
             "labels": c.labels, "target": c.target, "error": c.error, "seconds": c.seconds, "result": c.result}
            for c in cases
        ], ensure_ascii=False, indent=1), encoding="utf-8")
    return 0 if not any(c.error for c in cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
