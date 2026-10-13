"""ASR bake-off for the reading assessment: faster-whisper vs Parakeet (sherpa-onnx), in process.

Same synthetic cases as ``calibrate.py --synthetic`` (30 security sentences x variants
exact/drop/substitute/insert/respell x voices), synthesized once with Kokoro and cached
as MP3 under ``--bakeoff-dir/audio`` (the production format), then every clip goes through
the *real* service pipeline (``SpeechService.assess``: mp3 decode -> ASR -> alignment ->
homophone rescue -> scores) with each ASR engine and the phoneme engine disabled, so the
report isolates what the ASR contributes.

Per engine: detection of the changed word per variant, false positives on correct words,
confusion matrix, WER on the ``exact`` clips, word-timestamp error against Kokoro's own word
times, confidence distribution, ASR latency per clip at each thread count and the RSS delta
of loading the model.

    HF_HOME=/path/hf uv run python scripts/asr_bakeoff.py --bakeoff-dir /path/bakeoff \
        --parakeet-model /path/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 --out BAKEOFF.md --dump results.json
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import statistics
import subprocess
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from calibrate import GOLD, STATUSES, VARIANTS, Case, confusion_table, fmt, prf, synthetic_cases, words_of  # noqa: E402
from speech import audio as audio_tools  # noqa: E402
from speech.config import Settings  # noqa: E402
from speech.engines.base import DisabledTTS, HeardWord  # noqa: E402
from speech.runtime import RuntimeConfig, resolve_runtime  # noqa: E402
from speech.service import SpeechService, build_phoneme_engine  # noqa: E402
from speech.textnorm import compare_key, display_tokens, normalize_text  # noqa: E402

TTS_SAMPLE_RATE = 24_000


# ------------------------------------------------------------------ helpers
def rss_mb() -> float:
    """Current resident set size in MB (``ps``: works on macOS and Linux without psutil)."""
    try:
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())], capture_output=True, text=True, check=True).stdout
        return int(out.strip()) / 1024.0
    except Exception:  # noqa: BLE001
        return float("nan")


def wer(reference: str, hypothesis: list[HeardWord]) -> tuple[int, int]:
    """(edits, reference words) with the service's normalization (hyphens/spaces ignored)."""
    ref = [compare_key(t) for t in normalize_text(reference)]
    hyp = [compare_key(t) for t in normalize_text(" ".join(w.text for w in hypothesis))]
    n, m = len(ref), len(hyp)
    d = list(range(m + 1))
    for i in range(1, n + 1):
        prev, d[0] = d[0], i
        for j in range(1, m + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (0 if ref[i - 1] == hyp[j - 1] else 1))
            prev = cur
    return d[m], n


@dataclass
class Clip:
    case: Case
    mp3: bytes
    duration: float
    tts_words: list[dict[str, Any]]  # Kokoro word times of the *spoken* text
    mp3_path: Path = Path()


@dataclass
class EngineRun:
    name: str
    model: str
    load_seconds: float = 0.0
    rss_before: float = 0.0
    rss_after_load: float = 0.0
    rss_after_warmup: float = 0.0
    threads: int = 0
    results: dict[str, dict[str, Any]] = field(default_factory=dict)  # case name -> assess result
    heard: dict[str, list[HeardWord]] = field(default_factory=dict)
    phoneme_load_seconds: float = 0.0
    latency: dict[str, list[float]] = field(default_factory=dict)  # "<threads>t/<parallel>" -> seconds per clip
    asr_latency: dict[str, list[float]] = field(default_factory=dict)  # same keys, ASR call only
    errors: list[str] = field(default_factory=list)
    has_confidence: bool = False


# ------------------------------------------------------------------ synthesis
def synthesize_all(cases: list[Case], audio_dir: Path, torch_threads: int) -> list[Clip]:
    audio_dir.mkdir(parents=True, exist_ok=True)
    todo = [c for c in cases if not (audio_dir / f"{c.name}.mp3").exists() or not (audio_dir / f"{c.name}.json").exists()]
    if todo:
        from speech.engines.kokoro_tts import KokoroTTS

        tts = KokoroTTS("hexgrad/Kokoro-82M", "af_heart", torch_threads)
        t0 = time.perf_counter()
        tts.load()
        print(f"kokoro loaded in {time.perf_counter() - t0:.1f} s; synthesizing {len(todo)} clips", file=sys.stderr)
        for i, case in enumerate(todo, 1):
            lang = "en-gb" if (case.voice or "").startswith("b") else "en-us"
            result = tts.synthesize(case.spoken or case.reference, case.voice or "af_heart", 1.0, lang)
            (audio_dir / f"{case.name}.mp3").write_bytes(audio_tools.encode_mp3(result.audio_f32, result.sample_rate))
            meta = {
                "duration": result.duration,
                "words": [{"text": w.text, "start": w.start, "end": w.end, "char_start": w.char_start, "char_end": w.char_end} for w in result.words],
            }
            (audio_dir / f"{case.name}.json").write_text(json.dumps(meta), encoding="utf-8")
            if i % 25 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)} synthesized", file=sys.stderr)
        del tts
        gc.collect()
    clips = []
    for case in cases:
        meta = json.loads((audio_dir / f"{case.name}.json").read_text(encoding="utf-8"))
        clips.append(Clip(case, (audio_dir / f"{case.name}.mp3").read_bytes(), float(meta["duration"]), meta["words"], audio_dir / f"{case.name}.mp3"))
    return clips


# ------------------------------------------------------------------ engines
def build_engine(name: str, threads: int, whisper_model: str, parakeet_model: str):
    if name == "faster-whisper":
        from speech.engines.faster_whisper_asr import FasterWhisperASR

        return FasterWhisperASR(whisper_model, "int8", threads)
    if name == "parakeet":
        from speech.engines.parakeet_asr import ParakeetASR

        return ParakeetASR(parakeet_model, "int8", threads)
    raise ValueError(name)


class _TimedTranscribe:
    """Stands in for ``engine.transcribe`` and records the wall time of the last call."""

    def __init__(self, engine) -> None:
        self._inner = engine.transcribe
        self.seconds = 0.0
        self.last: list[HeardWord] | None = None

    def __call__(self, pcm: np.ndarray, **kwargs):
        t0 = time.perf_counter()
        self.last = self._inner(pcm, **kwargs)
        self.seconds = time.perf_counter() - t0
        return self.last


def make_settings(bakeoff_dir: Path, phoneme: str) -> Settings:
    """Service settings for the bake-off: TTS/ASR built by hand, phoneme engine as requested."""
    os.environ.setdefault("HF_HOME", str(bakeoff_dir / "hf"))
    os.environ["SPEECH_PHONEME_ENGINE"] = phoneme
    os.environ["SPEECH_TTS_ENGINE"] = "none"
    os.environ["SPEECH_ASR_ENGINE"] = "none"
    os.environ["SPEECH_CACHE_DIR"] = str(bakeoff_dir / "cache")
    os.environ["SPEECH_PRELOAD"] = "false"
    return Settings(_env_file=None)


def runtime_for(threads: int, mode: str) -> RuntimeConfig:
    """The production thread rule for a machine with ``threads`` CPUs (runtime.resolve_runtime):
    phonemes in parallel split the budget (phoneme ``threads // 2``, ASR the rest)."""
    return resolve_runtime(cpus=threads, parallel_phonemes=mode)


def build_pair(name: str, settings: Settings, runtime: RuntimeConfig, whisper_model: str, parakeet_model: str):
    engine = build_engine(name, runtime.asr_threads, whisper_model, parakeet_model)
    phon = build_phoneme_engine(settings, runtime)
    return engine, phon


def probe(name: str, threads: int, mode: str, phoneme: str, whisper_model: str, parakeet_model: str, mp3_path: str, bakeoff_dir: str) -> None:
    """Runs in a child process: RSS before / after loading ASR (+ phoneme) / after one assess."""
    settings = make_settings(Path(bakeoff_dir), phoneme)
    runtime = runtime_for(threads, mode)
    before = rss_mb()
    engine, phon = build_pair(name, settings, runtime, whisper_model, parakeet_model)
    t0 = time.perf_counter()
    engine.load()
    load_asr = time.perf_counter() - t0
    t0 = time.perf_counter()
    phon.load()
    load_ph = time.perf_counter() - t0
    after = rss_mb()
    service = SpeechService(settings, tts=DisabledTTS(), asr=engine, phoneme=phon, runtime=runtime)
    service.assess(Path(mp3_path).read_bytes(), "audio/mpeg", "security awareness training", "en")
    print(before, after, rss_mb(), load_asr, load_ph)


def rss_probe(name: str, threads: int, mode: str, phoneme: str, whisper_model: str, parakeet_model: str, mp3_path: Path, bakeoff_dir: Path) -> tuple[float, ...]:
    """(rss before, after load, after first assess, ASR load s, phoneme load s) in a fresh process.

    In-process deltas are polluted by memory the previous engine (or Kokoro) is still
    releasing; a child process gives a clean baseline.
    """
    code = (
        f"import sys; sys.path.insert(0, {str(ROOT)!r}); sys.path.insert(0, {str(ROOT / 'scripts')!r})\n"
        f"from asr_bakeoff import probe\n"
        f"probe({name!r}, {threads}, {mode!r}, {phoneme!r}, {whisper_model!r}, {parakeet_model!r}, {str(mp3_path)!r}, {str(bakeoff_dir)!r})\n"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True, env=os.environ).stdout.strip().splitlines()[-1]
    return tuple(float(x) for x in out.split())


def run_engine(
    name: str, clips: list[Clip], configs: list[tuple[int, str]], settings: Settings, whisper_model: str, parakeet_model: str,
    *, phoneme: str, subset: int, bakeoff_dir: Path,
) -> EngineRun:
    run = EngineRun(name=name, model="")
    pcm_cache: dict[str, np.ndarray] = {}
    with_phonemes = phoneme != "none"
    for k, (threads, mode) in enumerate(configs):
        gc.collect()
        runtime = runtime_for(threads, mode)
        engine, phon = build_pair(name, settings, runtime, whisper_model, parakeet_model)
        t0 = time.perf_counter()
        engine.load()
        phon.load()
        load_s = time.perf_counter() - t0
        service = SpeechService(settings, tts=DisabledTTS(), asr=engine, phoneme=phon, runtime=runtime)
        timed = _TimedTranscribe(engine)
        engine.transcribe = timed  # type: ignore[method-assign]
        # warm-up (graph warm-up / page-in) is not timed
        service.assess(clips[0].mp3, "audio/mpeg", clips[0].case.reference, "en")
        if k == 0:
            run.model = os.path.basename(os.path.normpath(engine.model)) if os.path.isdir(engine.model) else engine.model
            run.threads = threads
            run.rss_before, run.rss_after_load, run.rss_after_warmup, run.load_seconds, run.phoneme_load_seconds = rss_probe(
                name, threads, mode, phoneme, whisper_model, parakeet_model, clips[0].mp3_path, bakeoff_dir
            )
        key = f"{threads}t/{mode}"
        print(f"[{name}] {key} (asr {runtime.asr_threads} / phoneme {runtime.phoneme_threads} threads, parallel={runtime.parallel_phonemes}) loaded in {load_s:.1f} s "
              f"(fresh process: asr {run.load_seconds:.1f} s + phonemes {run.phoneme_load_seconds:.1f} s, RSS +{run.rss_after_load - run.rss_before:.0f} MB, "
              f"+{run.rss_after_warmup - run.rss_before:.0f} MB after the first assess)", file=sys.stderr)
        # First config: every clip through the full production pipeline (decode + ASR + align +
        # homophones + phonemes + scores) = the quality numbers. Other configs: latency only, on a
        # subset; without phonemes only the ASR call is timed (transcribe), with phonemes the whole
        # assess (that is what the user waits for).
        todo = clips if k == 0 or subset <= 0 else clips[:subset]
        lat: list[float] = []
        asr_lat: list[float] = []
        for i, clip in enumerate(todo, 1):
            if k == 0 or with_phonemes:
                t1 = time.perf_counter()
                try:
                    result = service.assess(clip.mp3, "audio/mpeg", clip.case.reference, "en")
                    total = time.perf_counter() - t1
                    if k == 0:
                        run.results[clip.case.name] = result
                        run.heard[clip.case.name] = timed.last or []
                except Exception as exc:  # noqa: BLE001
                    run.errors.append(f"{clip.case.name}: {type(exc).__name__}: {exc}")
                    total = time.perf_counter() - t1
                lat.append(total if with_phonemes else timed.seconds)
                asr_lat.append(timed.seconds)
            else:
                pcm = pcm_cache.setdefault(clip.case.name, audio_tools.decode_to_f32(clip.mp3, audio_tools.ASR_SAMPLE_RATE))
                timed(pcm)
                lat.append(timed.seconds)
                asr_lat.append(timed.seconds)
            if i % 50 == 0 or i == len(todo):
                print(f"  [{name}/{key}] {i}/{len(todo)} clips, mean {'assess' if with_phonemes else 'ASR'} {statistics.mean(lat):.3f} s", file=sys.stderr)
        run.latency[key] = lat
        run.asr_latency[key] = asr_lat
        del engine, phon, service
        gc.collect()
    run.has_confidence = any(w.probability < 0.999 for words in run.heard.values() for w in words)
    return run


# ------------------------------------------------------------------ report
def pct(a: int, b: int) -> str:
    return f"{a}/{b} ({100.0 * a / b:.1f}%)" if b else "—"


def _target_rows(run: EngineRun, cases: list[Case]) -> dict[str, tuple[int, int, Counter]]:
    out = {}
    for variant in ("drop", "substitute", "respell"):
        group = [c for c in cases if c.variant == variant and c.target is not None and c.name in run.results]
        hits, reasons = 0, Counter()
        for c in group:
            w = run.results[c.name]["words"][c.target]
            if w["status"] == c.labels[c.target]:
                hits += 1
                reasons[w.get("reason") or w["status"]] += 1
            else:
                reasons[f"não ({w['status']})"] += 1
        out[variant] = (hits, len(group), reasons)
    return out


def render(runs: list[EngineRun], cases: list[Case], clips: list[Clip], meta: dict[str, Any]) -> str:
    L: list[str] = []
    names = [r.name for r in runs]
    clip_by_name = {cl.case.name: cl for cl in clips}
    L += ["## Configuração", "",
          f"- Casos: {len(cases)} clipes ({len(meta['voices'])} vozes × {meta['sentences']} frases × {len(meta['variants'])} variantes), "
          f"{sum(len(c.labels) for c in cases)} palavras rotuladas; áudio Kokoro em MP3 64 kb/s (formato de produção), duração média {statistics.mean(cl.duration for cl in clips):.1f} s",
          f"- Vozes: {', '.join(meta['voices'])}; variantes: {', '.join(meta['variants'])}",
          f"- Pipeline: `SpeechService.assess` em processo (decodificação → ASR → alinhamento → homófonos → {'fonemas (' + meta['phoneme'] + ') → ' if meta['phoneme'] != 'none' else ''}notas); "
          f"fonemas `{meta['phoneme']}`; `SPEECH_WEAK_CONFIDENCE={meta['weak_confidence']}`; `SPEECH_PHONEME_WORD_THRESHOLD={meta['phoneme_threshold']}`",
          f"- Máquina: {meta['machine']}; configurações medidas (threads/fonemas em paralelo): {', '.join(f'{t}t/{m}' for t, m in meta['configs'])}"
          + (f"; latência das demais configurações num subconjunto de {meta['subset']} clipes" if meta['subset'] else "")
          + f"; tempo total {meta['elapsed'] / 60:.1f} min", ""]

    ph = meta["phoneme"] != "none"
    L += ["## Engines", "", f"| engine | modelo | carga ASR (s) | {'carga fonemas (s) | ' if ph else ''}RSS ao carregar{' (ASR + fonemas)' if ph else ''} | RSS após 1º assess | timestamps por palavra | confiança por palavra |",
          "|---|---|---:|" + ("---:|" if ph else "") + "---:|---:|---|---|"]
    for r in runs:
        ts_ok = sum(1 for ws in r.heard.values() for w in ws if w.end > w.start)
        ts_n = sum(len(ws) for ws in r.heard.values())
        L.append(f"| {r.name} | `{r.model}` | {r.load_seconds:.1f} | {f'{r.phoneme_load_seconds:.1f} | ' if ph else ''}+{r.rss_after_load - r.rss_before:.0f} MB | +{r.rss_after_warmup - r.rss_before:.0f} MB | "
                 f"sim ({ts_ok}/{ts_n} com fim > início) | {'sim' if r.has_confidence else 'não (fixa em 1,0)'} |")

    # Priority 1 & 2: detection per variant and false positives.
    L += ["", "## Detecção do erro plantado (alvo com o status esperado)", "",
          "| variante | esperado | " + " | ".join(names) + " |", "|---|---|" + "---:|" * len(names)]
    rows = {r.name: _target_rows(r, cases) for r in runs}
    for variant, expected in (("respell", "mispronounced"), ("substitute", "mispronounced"), ("drop", "missed")):
        cells = []
        for n in names:
            hits, total, reasons = rows[n][variant]
            cells.append(f"**{pct(hits, total)}**<br>" + ", ".join(f"{k} {v}" for k, v in reasons.most_common()))
        L.append(f"| {variant} | {expected} | " + " | ".join(cells) + " |")

    # Respell overlap between engines (lower bound of audible mispronunciations).
    if len(runs) >= 2:
        resp = [c for c in cases if c.variant == "respell" and all(c.name in r.results for r in runs)]
        det = {r.name: {c.name for c in resp if r.results[c.name]["words"][c.target]["status"] == "mispronounced"} for r in runs}
        a, b = names[0], names[1]
        both, only_a, only_b = det[a] & det[b], det[a] - det[b], det[b] - det[a]
        neither = len(resp) - len(det[a] | det[b])
        L += ["", f"`respell`: detectado por ambos {len(both)}, só {a} {len(only_a)}, só {b} {len(only_b)}, nenhum {neither} (de {len(resp)}). "
              "Em CALIBRACAO.md, 25/90 respellings foram lidos pelo Kokoro exatamente como a palavra certa (sem erro audível): o teto realista é ~65/90.", ""]

    L += ["## Falsos positivos (palavra rotulada `ok`)", "", "| métrica | " + " | ".join(names) + " |", "|---|" + "---:|" * len(names)]
    def fp(r: EngineRun, variants: set[str] | None, statuses: set[str]) -> str:
        words = [(c, g, w) for c, g, w in words_of(_with_results(r, cases, variants)) if g == "ok"]
        hit = sum(1 for _c, _g, w in words if w["status"] in statuses)
        return pct(hit, len(words))
    for label, variants, statuses in (
        ("`exact`: corretas → mispronounced/missed", {"exact"}, {"mispronounced", "missed"}),
        ("`exact`: corretas → weak", {"exact"}, {"weak"}),
        ("todas as variantes: corretas → mispronounced/missed", None, {"mispronounced", "missed"}),
        ("todas as variantes: corretas → weak", None, {"weak"}),
    ):
        L.append(f"| {label} | " + " | ".join(fp(r, variants, statuses) for r in runs) + " |")
    L += ["", "`insert`: clipes com exatamente 1 `extra`: " + "; ".join(
        f"{r.name} {sum(1 for c in cases if c.variant == 'insert' and c.name in r.results and len(r.results[c.name]['extras']) == 1)}/{sum(1 for c in cases if c.variant == 'insert' and c.name in r.results)}" for r in runs), ""]

    # Confusion matrices and PRF
    for r in runs:
        all_words = words_of(_with_results(r, cases, None))
        confusion, gold_rows = confusion_table((g, w["status"]) for _c, g, w in all_words)
        L += [f"## Matriz de confusão: {r.name}", "", "| rótulo \\ previsto | " + " | ".join(STATUSES) + " | total |", "|---|" + "---:|" * (len(STATUSES) + 1)]
        for gold in gold_rows:
            L.append(f"| **{gold}** | " + " | ".join(str(confusion[gold][s]) for s in STATUSES) + f" | {sum(confusion[gold].values())} |")
        L += ["", "| status | precisão | revocação | F1 | suporte |", "|---|---:|---:|---:|---:|"]
        for status in GOLD:
            p, rc, f, support = prf(confusion, status)
            L.append(f"| {status} | {fmt(p)} | {fmt(rc)} | {fmt(f)} | {support} |")
        tp = sum(1 for _c, g, w in all_words if g != "ok" and w["status"] in {"mispronounced", "missed"})
        fpn = sum(1 for _c, g, w in all_words if g == "ok" and w["status"] in {"mispronounced", "missed"})
        fn = sum(1 for _c, g, w in all_words if g != "ok" and w["status"] not in {"mispronounced", "missed"})
        p = tp / (tp + fpn) if tp + fpn else None
        rc = tp / (tp + fn) if tp + fn else None
        f = 2 * p * rc / (p + rc) if p and rc else None
        L += ["", f"Detecção binária de erro (mispronounced+missed): precisão {fmt(p)}, revocação {fmt(rc)}, F1 {fmt(f)}.", ""]

    # WER on exact
    L += ["## WER nos clipes `exact` (vocabulário de segurança)", "", "| engine | erros | palavras | WER |", "|---|---:|---:|---:|"]
    for r in runs:
        e = n = 0
        for c in cases:
            if c.variant == "exact" and c.name in r.heard:
                de, dn = wer(c.reference, r.heard[c.name])
                e, n = e + de, n + dn
        L.append(f"| {r.name} | {e} | {n} | {100.0 * e / n if n else 0:.2f}% |")

    # Timestamps vs Kokoro word times (exact clips, words aligned ok)
    L += ["", "## Timestamps por palavra × tempos do Kokoro (clipes `exact`, palavras `ok`)", "",
          "Erro absoluto entre o tempo da palavra segundo o ASR e o tempo da mesma palavra na síntese (o MP3 não desloca o áudio).", "",
          "| engine | n | início: média | início: p90 | fim: média | fim: p90 | duração média da palavra (ASR) |", "|---|---:|---:|---:|---:|---:|---:|"]
    for r in runs:
        ds, de, dur = [], [], []
        for c in cases:
            if c.variant != "exact" or c.name not in r.results:
                continue
            tts_words = clip_by_name[c.name].tts_words
            by_char = {(w["char_start"], w["char_end"]): w for w in tts_words}
            for w in r.results[c.name]["words"]:
                tw = by_char.get((w["char_start"], w["char_end"]))
                if w["status"] == "ok" and tw and w["start"] is not None:
                    ds.append(abs(w["start"] - tw["start"]))
                    de.append(abs(w["end"] - tw["end"]))
                    dur.append(w["end"] - w["start"])
        if ds:
            ds.sort()
            de.sort()
            L.append(f"| {r.name} | {len(ds)} | {statistics.mean(ds):.3f} s | {ds[int(0.9 * len(ds))]:.3f} s | {statistics.mean(de):.3f} s | {de[int(0.9 * len(de))]:.3f} s | {statistics.mean(dur):.3f} s |")

    # Confidence
    L += ["", "## Confiança por palavra", "", "| engine | corretas: média | corretas: p10 | corretas < 0,6 | erradas (troca/respelling): média | erradas < 0,6 |", "|---|---:|---:|---:|---:|---:|"]
    for r in runs:
        ok_c, bad_c = [], []
        for c, g, w in words_of(_with_results(r, cases, None)):
            if w.get("confidence") is None:
                continue
            (ok_c if g == "ok" else bad_c if g == "mispronounced" else []).append(w["confidence"])
        ok_c.sort()
        if ok_c:
            L.append(f"| {r.name} | {statistics.mean(ok_c):.3f} | {ok_c[int(0.1 * len(ok_c))]:.3f} | {pct(sum(1 for x in ok_c if x < 0.6), len(ok_c))} | "
                     f"{statistics.mean(bad_c) if bad_c else float('nan'):.3f} | {pct(sum(1 for x in bad_c if x < 0.6), len(bad_c))} |")

    # Latency
    what = "`assess` completo (decodificação + ASR + alinhamento + fonemas + notas)" if ph else "só `transcribe`"
    L += ["", f"## Latência por clipe ({what}, CPU, int8)", "",
          f"Clipes de {statistics.mean(cl.duration for cl in clips):.1f} s em média; RTF = tempo ÷ duração do áudio. "
          + ("Threads = CPUs da máquina simulada: a regra do serviço dá tudo ao ASR e aos fonemas em sequência (`off`) ou divide o orçamento (`on`: fonemas `threads // 2`, ASR o resto)." if ph else ""), "",
          f"| engine | threads | fonemas em paralelo | n | média | mediana | p95 | RTF médio |{' só ASR (média) |' if ph else ''}", "|---|---:|---|---:|---:|---:|---:|---:|" + ("---:|" if ph else "")]
    for r in runs:
        for key in sorted(r.latency, key=lambda k: (int(k.split("t/")[0]), k)):
            lat = r.latency[key]
            threads, mode = key.split("t/")
            srt = sorted(lat)
            rtf = statistics.mean(sec / clip_by_name[cl.case.name].duration for sec, cl in zip(lat, clips[: len(lat)], strict=True))
            asr = f" {statistics.mean(r.asr_latency[key]):.3f} s |" if ph else ""
            L.append(f"| {r.name} | {threads} | {mode} | {len(lat)} | {statistics.mean(srt):.3f} s | {srt[len(srt) // 2]:.3f} s | {srt[int(0.95 * len(srt))]:.3f} s | {rtf:.3f} |{asr}")

    # Examples: respell cases where the engines differ
    if len(runs) >= 2:
        a, b = runs[0], runs[1]
        L += ["", "## Exemplos `respell`: o que cada engine ouviu (alvo)", "", f"| caso | palavra | grafia falada | {a.name} | {b.name} |", "|---|---|---|---|---|"]
        shown = 0
        for c in cases:
            if c.variant != "respell" or c.name not in a.results or c.name not in b.results:
                continue
            wa, wb = a.results[c.name]["words"][c.target], b.results[c.name]["words"][c.target]
            if wa["status"] == wb["status"] and shown > 10:
                continue
            spoken_tok = display_tokens(c.spoken or "")[c.target].text
            L.append(f"| {c.name} | {wa['text']} | {spoken_tok} | {wa['status']}: {wa['heard'] or '—'} | {wb['status']}: {wb['heard'] or '—'} |")
            shown += 1
            if shown >= 40:
                break
        L += ["", "## Falsos positivos nos `exact` (palavra correta marcada mispronounced/missed)", "", "| engine | caso | palavra | status | ouvido |", "|---|---|---|---|---|"]
        for r in runs:
            n = 0
            for c in cases:
                if c.variant != "exact" or c.name not in r.results:
                    continue
                for w in r.results[c.name]["words"]:
                    if w["status"] in {"mispronounced", "missed"}:
                        L.append(f"| {r.name} | {c.name} | {w['text']} | {w['status']} | {w['heard'] or '—'} |")
                        n += 1
                    if n >= 20:
                        break
                if n >= 20:
                    L.append(f"| {r.name} | … | | | |")
                    break
    errors = [(r.name, e) for r in runs for e in r.errors]
    if errors:
        L += ["", "## Erros", ""] + [f"- {n}: {e}" for n, e in errors[:20]]
    return "\n".join(L) + "\n"


def _with_results(run: EngineRun, cases: list[Case], variants: set[str] | None) -> list[Case]:
    out = []
    for c in cases:
        if c.name in run.results and (variants is None or c.variant in variants):
            cc = Case(c.name, c.variant, c.reference, c.spoken, c.labels, c.voice, c.audio_path, c.target)
            cc.result = run.results[c.name]
            out.append(cc)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bakeoff-dir", type=Path, required=True, help="audio cache (and default model location) directory")
    parser.add_argument("--voices", default="af_heart,am_michael,bf_emma")
    parser.add_argument("--variants", default=",".join(VARIANTS))
    parser.add_argument("--limit", type=int, default=None, help="only the first N sentences")
    parser.add_argument("--engines", default="faster-whisper,parakeet")
    parser.add_argument("--threads", default="4,8", help="CPU counts to time (quality uses the first configuration)")
    parser.add_argument("--phoneme", default="none", help="SPEECH_PHONEME_ENGINE for the assessment: none|wav2vec2")
    parser.add_argument("--parallel", default="off", help="SPEECH_PARALLEL_PHONEMES modes to time (off,on); only with --phoneme")
    parser.add_argument("--latency-subset", type=int, default=0, help="clips used for the latency-only configurations (0 = all)")
    parser.add_argument("--whisper-model", default="small.en")
    parser.add_argument("--parakeet-model", default="sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", help="directory or k2-fsa release name")
    parser.add_argument("--torch-threads", type=int, default=8, help="Kokoro synthesis threads")
    parser.add_argument("--machine", default="MacBook Pro M1 Pro")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--dump", type=Path, default=None)
    args = parser.parse_args(argv)

    settings = make_settings(args.bakeoff_dir, args.phoneme)

    voices = [v.strip() for v in args.voices.split(",") if v.strip()]
    variants = [v for v in args.variants.split(",") if v]
    cases = synthetic_cases(voices, args.limit, variants)
    started = time.perf_counter()
    clips = synthesize_all(cases, args.bakeoff_dir / "audio", args.torch_threads)
    print(f"{len(clips)} clips ready ({time.perf_counter() - started:.0f} s)", file=sys.stderr)

    thread_counts = [int(t) for t in args.threads.split(",") if t]
    modes = [m.strip() for m in args.parallel.split(",") if m.strip()] if args.phoneme != "none" else ["off"]
    configs = [(t, m) for t in thread_counts for m in modes]
    runs = [
        run_engine(name.strip(), clips, configs, settings, args.whisper_model, args.parakeet_model,
                   phoneme=args.phoneme, subset=args.latency_subset, bakeoff_dir=args.bakeoff_dir)
        for name in args.engines.split(",") if name.strip()
    ]
    meta = {
        "voices": voices, "variants": variants, "sentences": len({c.reference for c in cases}), "configs": configs, "subset": args.latency_subset,
        "phoneme": args.phoneme, "phoneme_threshold": settings.phoneme_word_threshold,
        "weak_confidence": settings.weak_confidence, "machine": args.machine, "elapsed": time.perf_counter() - started,
    }
    text = render(runs, cases, clips, meta)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
        print(f"report written to {args.out}", file=sys.stderr)
    else:
        print(text)
    if args.dump:
        args.dump.write_text(json.dumps({
            "meta": meta,
            "engines": [{
                "name": r.name, "model": r.model, "load_seconds": r.load_seconds, "rss_before": r.rss_before, "rss_after_load": r.rss_after_load,
                "rss_after_warmup": r.rss_after_warmup, "phoneme_load_seconds": r.phoneme_load_seconds, "latency": r.latency, "asr_latency": r.asr_latency, "errors": r.errors,
                "heard": {k: [{"text": w.text, "start": w.start, "end": w.end, "probability": w.probability} for w in ws] for k, ws in r.heard.items()},
                "results": r.results,
            } for r in runs],
            "cases": [{"name": c.name, "variant": c.variant, "voice": c.voice, "reference": c.reference, "spoken": c.spoken, "labels": c.labels, "target": c.target} for c in cases],
        }, ensure_ascii=False), encoding="utf-8")
    return 1 if any(r.errors for r in runs) else 0


if __name__ == "__main__":
    raise SystemExit(main())
