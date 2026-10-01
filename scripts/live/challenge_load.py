"""Load test of a self-paced challenge (Incremento 6): N participants open the link, join,
start an attempt and answer every item over REST within a short window (a whole class
or event audience doing the challenge at the same time, the worst case for a link).

Pass criteria: every join and every answer accepted; p95 per request below the budget
(RNF-103 style, ``--p95-ms``); the owner panel and the report stay fast with N finished
attempts. Prints JSON; exit 1 on failure.

    python scripts/live/challenge_load.py --participants 1000 --questions 5
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
import time
import uuid
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime, timedelta

import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loadtest import summary  # noqa: E402

KINDS = ("info", "join", "start", "answer", "finish")


def _slice(base: str, slug: str, indexes: list[int], concurrency: int, window: float, insecure: bool) -> dict:
    """One client process: its participants play the whole challenge."""

    async def run() -> dict:
        latencies: dict[str, list[float]] = {k: [] for k in KINDS}
        statuses: dict[str, dict[str, int]] = {k: {} for k in KINDS}
        sem = asyncio.Semaphore(concurrency)
        limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
        async with httpx.AsyncClient(base_url=base, timeout=60, limits=limits, verify=not insecure) as http:

            async def timed(kind: str, method: str, url: str, **kw) -> httpx.Response:
                async with sem:
                    t0 = time.perf_counter()
                    response = await http.request(method, url, **kw)
                    latencies[kind].append((time.perf_counter() - t0) * 1000)
                key = str(response.status_code)
                statuses[kind][key] = statuses[kind].get(key, 0) + 1
                return response

            async def person(index: int) -> None:
                rng = random.Random(index)
                await asyncio.sleep(rng.uniform(0, window * 0.3))
                await timed("info", "GET", f"/api/live/q/{slug}")
                joined = await timed("join", "POST", f"/api/live/q/{slug}/join",
                                     json={"display_name": f"Desafio {index:05d}", "consent": True})
                if joined.status_code != 201:
                    return
                auth = {"Authorization": f"Bearer {joined.json()['token']}"}
                state = (await timed("start", "POST", f"/api/live/q/{slug}/attempts", headers=auth)).json()
                while state.get("status") == "in_progress":
                    item = state["item"]
                    await asyncio.sleep(rng.uniform(0.2, window / 10))  # reading and thinking
                    options = item.get("options") or []
                    pick = options[0]["id"] if index % 3 else options[-1]["id"]
                    response = await timed(
                        "answer", "POST", f"/api/live/q/{slug}/attempts/{state['attempt_id']}/answers", headers=auth,
                        json={"answer_id": str(uuid.uuid4()), "qi": item["qi"], "choice": [pick]},
                    )
                    body = response.json()
                    key = "answer_" + str(body.get("status"))
                    statuses["answer"][key] = statuses["answer"].get(key, 0) + 1
                    state = body.get("state") or {}
                if state.get("status") != "finished":
                    await timed("finish", "POST", f"/api/live/q/{slug}/attempts/{state.get('attempt_id')}/finish", headers=auth)

            await asyncio.gather(*(person(i) for i in indexes))
        return {"latencies": latencies, "statuses": statuses}

    return asyncio.run(run())


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--participants", type=int, default=300)
    ap.add_argument("--questions", type=int, default=5)
    ap.add_argument("--window", type=float, default=30.0, help="seconds over which people start and play")
    ap.add_argument("--concurrency", type=int, default=240)
    ap.add_argument("--procs", type=int, default=4)
    ap.add_argument("--p95-ms", type=float, default=500.0)
    ap.add_argument("--insecure", action="store_true")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    failures: list[str] = []
    async with httpx.AsyncClient(base_url=base, timeout=60, verify=not args.insecure) as http:
        email = f"challenge-{uuid.uuid4().hex[:8]}@example.com"
        await http.post("/api/auth/register", json={"email": email, "password": "correct-horse-battery"})
        (await http.post("/api/auth/login", json={"email": email, "password": "correct-horse-battery"})).raise_for_status()
        quiz = (await http.post("/api/live/quizzes", json={"title": "Desafio de carga"})).json()
        for i in range(args.questions):
            quiz = (await http.post(f"/api/live/quizzes/{quiz['id']}/items", json={
                "expected_version": quiz["version"], "item_type": "single_choice", "prompt": f"Pergunta {i + 1}?",
                "options": [{"text": "Certa", "correct": True}, {"text": "Errada"}, {"text": "Outra"}], "time_limit_s": 60,
            })).json()
        (await http.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})).raise_for_status()
        closes = (datetime.now(UTC) + timedelta(days=1)).isoformat()
        created = await http.post("/api/live/challenges", json={
            "quiz_id": quiz["id"], "closes_at": closes, "leaderboard": True, "max_participants": args.participants,
        })
        created.raise_for_status()
        challenge = created.json()
        slug = challenge["challenge"]["slug"]

        t0 = time.perf_counter()
        loop = asyncio.get_running_loop()
        slices = [list(range(k, args.participants, args.procs)) for k in range(args.procs)]
        with ProcessPoolExecutor(max_workers=args.procs) as pool:
            parts = await asyncio.gather(*(
                loop.run_in_executor(pool, _slice, base, slug, part, max(1, args.concurrency // args.procs), args.window, args.insecure)
                for part in slices
            ))
        elapsed = time.perf_counter() - t0
        latencies: dict[str, list[float]] = {k: [] for k in KINDS}
        statuses: dict[str, dict[str, int]] = {k: {} for k in KINDS}
        for part in parts:
            for kind in KINDS:
                latencies[kind].extend(part["latencies"][kind])
                for key, value in part["statuses"][kind].items():
                    statuses[kind][key] = statuses[kind].get(key, 0) + value

        t1 = time.perf_counter()
        panel = await http.get(f"/api/live/sessions/{challenge['id']}/challenge")
        panel_ms = (time.perf_counter() - t1) * 1000
        t1 = time.perf_counter()
        report = await http.get(f"/api/live/sessions/{challenge['id']}/report")
        report_ms = (time.perf_counter() - t1) * 1000

    result = {
        "participants": args.participants, "questions": args.questions, "seconds": round(elapsed, 1),
        "requests": {kind: {"latency_ms": summary(latencies[kind]), "status": statuses[kind]} for kind in KINDS},
        "panel": {"status": panel.status_code, "ms": round(panel_ms, 1), "funnel": panel.json().get("funnel")},
        "report": {"status": report.status_code, "ms": round(report_ms, 1), "participants": report.json().get("kpis", {}).get("participants")},
    }
    if statuses["join"].get("201", 0) != args.participants:
        failures.append(f"joins {statuses['join']}")
    accepted = statuses["answer"].get("answer_accepted", 0)
    if accepted != args.participants * args.questions:
        failures.append(f"answers accepted {accepted}/{args.participants * args.questions}: {statuses['answer']}")
    for kind in ("join", "start", "answer"):
        p95 = (result["requests"][kind]["latency_ms"] or {}).get("p95")
        if p95 is not None and p95 > args.p95_ms:
            failures.append(f"{kind} p95 {p95:.0f} ms > {args.p95_ms:.0f} ms")
    if result["panel"]["funnel"] and result["panel"]["funnel"]["finished"] != args.participants:
        failures.append(f"panel finished {result['panel']['funnel']}")
    if report.status_code != 200 or report_ms > 3000:
        failures.append(f"report {report.status_code} in {report_ms:.0f} ms")
    result["failures"] = failures
    print(json.dumps(result, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
