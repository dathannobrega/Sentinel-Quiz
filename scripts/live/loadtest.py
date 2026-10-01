"""Sentinel Arena load test (PLANO §16, RNF-101..RNF-106, RNF-201..RNF-205).

One process drives a host and N participants over the real HTTP + WebSocket API:

  1. join storm: N guests join the room (all from this machine's single IP);
  2. N sockets connect and receive the lobby snapshot;
  3. for each question: the host opens it, every participant answers within
     ``--answer-window`` seconds, the host reveals; per question it records the
     answer ack latency and the reveal fan-out (host command → last participant);
  4. the host ends the session and fetches the report.

Usage (API running with LIVE_ENABLED=true, LIVE_HOST_POLICY=all,
REGISTRATION_EMAIL_VERIFICATION=false, LIVE_MAX_PARTICIPANTS >= N):

    python scripts/live/loadtest.py --base http://127.0.0.1:8000 --participants 1000

Exit code 1 when any RNF target is missed. Results are printed as JSON.
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
from dataclasses import dataclass, field

import httpx
import websockets

SUBPROTOCOL = "sq.live.v1"


def _insecure() -> bool:
    # Self-signed TLS on a local nginx (--insecure); read from the environment so the
    # join/result child processes inherit it.
    return os.environ.get("LOADTEST_INSECURE") == "1"


def _ws_ssl():
    if not _insecure():
        return None
    import ssl

    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(q / 100.0 * (len(ordered) - 1)))))
    return round(ordered[index], 1)


def summary(values: list[float]) -> dict:
    return {"n": len(values), "p50": pct(values, 50), "p95": pct(values, 95), "p99": pct(values, 99), "max": pct(values, 100)}


ITEM_FIELDS: dict[str, dict] = {
    "single_choice": {"item_type": "single_choice", "options": [
        {"text": "Certa", "correct": True}, {"text": "Errada 1"}, {"text": "Errada 2"}, {"text": "Errada 3"}]},
    "ordering": {"item_type": "ordering", "options": [{"text": t} for t in ("Um", "Dois", "Três", "Quatro", "Cinco", "Seis")]},
    "numeric": {"item_type": "numeric", "min": 0, "max": 1000, "step": 1, "value": 500, "tolerance": 25},
    "word_cloud": {"item_type": "word_cloud", "max_words": 3},
}
# ~400 distinct words with a long tail, like a real audience.
LOAD_WORDS = [f"palavra{n}" for n in range(400)]


def answer_data(item_type: str, question: dict, index: int) -> dict:
    """Answer of participant ``index`` for the load question (deterministic spread)."""
    rng = random.Random(index)
    if item_type == "ordering":
        by_text = {o["text"]: o["id"] for o in question["options"]}
        order = [by_text[t] for t in ("Um", "Dois", "Três", "Quatro", "Cinco", "Seis")]
        if index % 3:
            rng.shuffle(order)
        return {"choice": order}
    if item_type == "numeric":
        return {"number": round(rng.gauss(500, 120) % 1000, 1)}
    if item_type == "word_cloud":
        return {"words": list(dict.fromkeys(LOAD_WORDS[int(rng.paretovariate(1.2)) % len(LOAD_WORDS)] for _ in range(3)))}
    return {"choice": [next(o["id"] for o in question["options"] if o["text"] == "Certa")]}


def frame(type_: str, data: dict | None = None) -> str:
    return json.dumps({"v": 1, "type": type_, "data": data or {}})


@dataclass
class Participant:
    index: int
    token: str = ""
    pid: str = ""
    ws: websockets.ClientConnection | None = None
    inbox: asyncio.Queue = field(default_factory=asyncio.Queue)
    reader: asyncio.Task | None = None
    errors: list[str] = field(default_factory=list)


async def reader(p: Participant) -> None:
    try:
        async for raw in p.ws:
            msg = json.loads(raw)
            if msg["type"] == "srv.ping":
                await p.ws.send(frame("pong", {"ts": msg["data"]["ts"]}))
                continue
            await p.inbox.put((time.perf_counter(), msg))
    except Exception as exc:  # connection dropped
        p.errors.append(f"reader:{type(exc).__name__}")


async def wait_for(p: Participant, type_: str, *, qi: int | None = None, timeout: float = 30.0) -> tuple[float, dict]:
    deadline = time.perf_counter() + timeout
    while True:
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            raise TimeoutError(f"participant {p.index}: no {type_}")
        at, msg = await asyncio.wait_for(p.inbox.get(), remaining)
        if msg["type"] == type_ and (qi is None or msg["data"].get("qi") == qi):
            return at, msg
        if msg["type"] == "error":
            p.errors.append(f"error:{msg['data'].get('code')}")


def _join_slice(base: str, code: str, indexes: list[int], concurrency: int) -> tuple[dict, dict, list[float]]:
    """Runs in a child process: join ``indexes`` and return tokens, statuses and latencies."""

    async def run() -> tuple[dict, dict, list[float]]:
        tokens: dict[int, tuple[str, str]] = {}
        statuses: dict[int | str, int] = {}
        latencies: list[float] = []
        sem = asyncio.Semaphore(concurrency)
        limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
        async with httpx.AsyncClient(base_url=base, timeout=30.0, limits=limits, verify=not _insecure()) as guests:
            async def join(index: int) -> None:
                async with sem:
                    body = {"display_name": f"Carga {index:04d}", "consent": True}
                    t0 = time.perf_counter()
                    try:
                        r = await guests.post(f"/api/live/rooms/{code}/join", json=body)
                    except (httpx.ReadError, httpx.RemoteProtocolError):
                        # Keep-alive race: the server closed an idle connection as we reused
                        # it. Retry once on a fresh connection (the request never ran).
                        statuses["retried"] = statuses.get("retried", 0) + 1
                        try:
                            r = await guests.post(f"/api/live/rooms/{code}/join", json=body)
                        except httpx.HTTPError as exc:
                            statuses[type(exc).__name__] = statuses.get(type(exc).__name__, 0) + 1
                            return
                    except httpx.HTTPError as exc:
                        statuses[type(exc).__name__] = statuses.get(type(exc).__name__, 0) + 1
                        return
                    latencies.append((time.perf_counter() - t0) * 1000)
                    statuses[r.status_code] = statuses.get(r.status_code, 0) + 1
                    if r.status_code == 201:
                        payload = r.json()
                        tokens[index] = (payload["token"], payload["participant_id"])

            await asyncio.gather(*(join(i) for i in indexes))
        return tokens, statuses, latencies

    return asyncio.run(run())


def _results_slice(base: str, tokens: list[str], concurrency: int) -> tuple[dict, list[float]]:
    """Child process: every participant opens "my results" when the session ends."""

    async def run() -> tuple[dict, list[float]]:
        statuses: dict[int | str, int] = {}
        latencies: list[float] = []
        sem = asyncio.Semaphore(concurrency)
        limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
        async with httpx.AsyncClient(base_url=base, timeout=30.0, limits=limits, verify=not _insecure()) as client:
            async def fetch(token: str) -> None:
                async with sem:
                    t0 = time.perf_counter()
                    for attempt in range(2):
                        try:
                            r = await client.get("/api/live/me/results", headers={"Authorization": f"Bearer {token}"})
                            break
                        except (httpx.ReadError, httpx.RemoteProtocolError):
                            if attempt:
                                statuses["ReadError"] = statuses.get("ReadError", 0) + 1
                                return
                        except httpx.HTTPError as exc:
                            statuses[type(exc).__name__] = statuses.get(type(exc).__name__, 0) + 1
                            return
                    latencies.append((time.perf_counter() - t0) * 1000)
                    statuses[r.status_code] = statuses.get(r.status_code, 0) + 1

            await asyncio.gather(*(fetch(t) for t in tokens))
        return statuses, latencies

    return asyncio.run(run())


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--participants", type=int, default=200)
    ap.add_argument("--questions", type=int, default=3)
    ap.add_argument("--answer-window", type=float, default=2.0, help="all answers arrive within this many seconds")
    ap.add_argument("--join-concurrency", type=int, default=200)
    ap.add_argument("--join-procs", type=int, default=3, help="client processes for the join storm")
    ap.add_argument("--origin", default="http://localhost:3000")
    ap.add_argument("--metrics-base", default="", help="API origin for /api/live/metrics when --base is a proxy")
    ap.add_argument("--insecure", action="store_true", help="accept a self-signed TLS certificate (local nginx)")
    ap.add_argument("--item-type", choices=["single_choice", "ordering", "numeric", "word_cloud"], default="single_choice",
                    help="question type of the run (GA types: live aggregates on every tick)")
    args = ap.parse_args()
    if args.insecure:
        os.environ["LOADTEST_INSECURE"] = "1"
    base = args.base.rstrip("/")
    ws_base = base.replace("http", "ws", 1) + "/api/live/ws"
    limits = httpx.Limits(max_connections=args.join_concurrency, max_keepalive_connections=args.join_concurrency)
    results: dict = {"participants": args.participants, "questions": args.questions}
    failures: list[str] = []

    async with httpx.AsyncClient(base_url=base, timeout=30.0, limits=limits, verify=not _insecure()) as http:
        email = f"load-{uuid.uuid4().hex[:8]}@example.com"
        await http.post("/api/auth/register", json={"email": email, "password": "correct-horse-battery"})
        login = await http.post("/api/auth/login", json={"email": email, "password": "correct-horse-battery"})
        login.raise_for_status()
        quiz = (await http.post("/api/live/quizzes", json={"title": "Load test", "settings": {"reading_phase_s": 0, "leaderboard_every": 0}})).json()
        for i in range(args.questions):
            quiz = (await http.post(f"/api/live/quizzes/{quiz['id']}/items", json={
                "expected_version": quiz["version"], "prompt": f"Pergunta de carga {i + 1}?", "time_limit_s": 30,
                **ITEM_FIELDS[args.item_type]})).json()
        published = await http.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
        published.raise_for_status()
        session = (await http.post("/api/live/sessions", json={"quiz_id": quiz["id"], "max_participants": args.participants})).json()
        if "join_code" not in session:
            print(json.dumps({"error": session}))
            return 1
        code = session["join_code"]
        cookies = "; ".join(f"{k}={v}" for k, v in http.cookies.items())

        # 1. Join storm (single IP). Spread over --join-procs client processes: one Python
        # process cannot generate 100 req/s of HTTPS-grade load and would measure itself.
        people = [Participant(i) for i in range(args.participants)]
        t0 = time.perf_counter()
        loop = asyncio.get_running_loop()
        slices = [list(range(k, args.participants, args.join_procs)) for k in range(args.join_procs)]
        with ProcessPoolExecutor(max_workers=args.join_procs) as pool:
            parts = await asyncio.gather(*(
                loop.run_in_executor(pool, _join_slice, base, code, part, max(1, args.join_concurrency // args.join_procs))
                for part in slices
            ))
        statuses: dict[int | str, int] = {}
        join_ms: list[float] = []
        for tokens, part_status, part_ms in parts:
            join_ms.extend(part_ms)
            for key, value in part_status.items():
                statuses[key] = statuses.get(key, 0) + value
            for index, (token, pid) in tokens.items():
                people[index].token, people[index].pid = token, pid
        results["join_storm"] = {"seconds": round(time.perf_counter() - t0, 2), "status": statuses, "latency_ms": summary(join_ms)}
        joined = [p for p in people if p.token]
        if any(isinstance(k, str) and k != "retried" for k in statuses) or len(joined) != args.participants:
            failures.append(f"RNF-205 join storm: {len(joined)}/{args.participants} joined, statuses {statuses}")
        storm_budget = 10.0 * args.participants / 1000  # 1,000 joins in 10 s (MVP-0)
        if results["join_storm"]["seconds"] > storm_budget:
            failures.append(f"RNF-205 join storm took {results['join_storm']['seconds']} s > {storm_budget:.0f} s")

        # 2. Sockets.
        sem = asyncio.Semaphore(args.join_concurrency)

        async def connect(p: Participant) -> None:
            async with sem:
                p.ws = await websockets.connect(ws_base, subprotocols=[SUBPROTOCOL], max_size=2**20, open_timeout=30, ssl=_ws_ssl() if ws_base.startswith("wss") else None)
                await p.ws.send(frame("hello", {"token": p.token}))
                p.reader = asyncio.create_task(reader(p))
                await wait_for(p, "room.snapshot")

        t0 = time.perf_counter()
        await asyncio.gather(*(connect(p) for p in joined))
        results["connect_seconds"] = round(time.perf_counter() - t0, 2)
        host = Participant(-1)
        host.ws = await websockets.connect(ws_base, subprotocols=[SUBPROTOCOL], additional_headers={"Cookie": cookies, "Origin": args.origin}, max_size=2**24, ssl=_ws_ssl() if ws_base.startswith("wss") else None)
        await host.ws.send(frame("hello", {"session_id": session["id"], "role": "host"}))
        host.reader = asyncio.create_task(reader(host))
        await wait_for(host, "room.snapshot")

        # 3. Questions.
        per_question = []
        for qi in range(args.questions):
            sent = time.perf_counter()
            await host.ws.send(frame("host.next" if qi else "host.start", {"expected_qi": qi - 1} if qi else {}))
            intros = await asyncio.gather(*(wait_for(p, "question.intro", qi=qi) for p in joined))
            intro_fanout = (max(at for at, _ in intros) - sent) * 1000
            questions = {p.index: msg["data"]["question"] for p, (_, msg) in zip(joined, intros)}
            acks: list[float] = []
            ack_status: dict[str, int] = {}

            async def answer(p: Participant) -> None:
                await asyncio.sleep(random.uniform(0, args.answer_window))
                t0 = time.perf_counter()
                data = answer_data(args.item_type, questions[p.index], p.index)
                await p.ws.send(frame("answer.submit", {"answer_id": str(uuid.uuid4()), "qi": qi, **data}))
                _, ack = await wait_for(p, "answer.ack", qi=qi)
                acks.append((time.perf_counter() - t0) * 1000)
                status = ack["data"]["status"]
                ack_status[status] = ack_status.get(status, 0) + 1

            burst = time.perf_counter()
            await asyncio.gather(*(answer(p) for p in joined))
            burst_s = time.perf_counter() - burst
            await wait_for(host, "question.locked", qi=qi, timeout=60)
            sent = time.perf_counter()
            await host.ws.send(frame("host.reveal", {"expected_qi": qi}))
            reveals = await asyncio.gather(*(wait_for(p, "question.reveal", qi=qi, timeout=60) for p in joined))
            reveal_fanout = (max(at for at, _ in reveals) - sent) * 1000
            personalised = sum(1 for _, msg in reveals if msg["data"].get("my"))
            per_question.append({
                "qi": qi, "intro_fanout_ms": round(intro_fanout, 1), "answers_seconds": round(burst_s, 2),
                "ack_ms": summary(acks), "ack_status": ack_status, "reveal_fanout_ms": round(reveal_fanout, 1),
                "reveal_personalised": personalised,
            })
            if ack_status.get("accepted", 0) != len(joined):
                failures.append(f"RNF-204 q{qi}: accepted {ack_status}")
            if (pct(acks, 95) or 0) > 300:
                failures.append(f"RNF-103 q{qi}: ack p95 {pct(acks, 95)} ms > 300 ms end to end")
            if reveal_fanout > 1000:  # client-observed (includes this generator); RNF-106 is checked server-side below
                failures.append(f"RNF-106 q{qi}: reveal fan-out {reveal_fanout:.0f} ms")
        results["per_question"] = per_question

        await host.ws.send(frame("host.end"))
        await wait_for(host, "session.ended", timeout=60)
        t0 = time.perf_counter()
        report = await http.get(f"/api/live/sessions/{session['id']}/report")
        results["report"] = {"status": report.status_code, "ms": round((time.perf_counter() - t0) * 1000, 1),
                             "participants": report.json().get("kpis", {}).get("participants")}
        if report.status_code != 200 or results["report"]["ms"] > 1500:
            failures.append(f"RNF-109 report {results['report']}")
        # Everyone opens "my results" at once.
        t0 = time.perf_counter()
        token_slices = [[p.token for p in joined[k:: args.join_procs]] for k in range(args.join_procs)]
        with ProcessPoolExecutor(max_workers=args.join_procs) as pool:
            parts = await asyncio.gather(*(
                loop.run_in_executor(pool, _results_slice, base, part, max(1, args.join_concurrency // args.join_procs))
                for part in token_slices
            ))
        my_status: dict[int | str, int] = {}
        my_ms: list[float] = []
        for part_status, part_ms in parts:
            my_ms.extend(part_ms)
            for key, value in part_status.items():
                my_status[key] = my_status.get(key, 0) + value
        results["my_results"] = {"seconds": round(time.perf_counter() - t0, 2), "status": my_status, "latency_ms": summary(my_ms)}
        # Everyone asks at the same instant: same budget as the join storm, and no errors.
        if my_status.get(200, 0) != len(joined) or results["my_results"]["seconds"] > storm_budget:
            failures.append(f"RNF-109 my results burst: {results['my_results']}")

        # nginx never exposes /api/live/metrics: scrape the API directly when behind a proxy.
        metrics_url = f"{args.metrics_base.rstrip('/')}/api/live/metrics" if args.metrics_base else "/api/live/metrics"
        server = await http.get(metrics_url, params={"format": "json"})
        if server.status_code == 200:  # loopback or LIVE_METRICS_TOKEN (one worker's view)
            results["server_metrics"] = server.json()["histograms"]
            reveal = results["server_metrics"].get('live_broadcast_seconds{type="question.reveal"}') or {}
            if (reveal.get("p95_ms") or 0) > 500:
                failures.append(f"RNF-106 server reveal broadcast p95 {reveal.get('p95_ms')} ms > 500 ms")
            accept = results["server_metrics"].get("live_answer_accept_seconds") or {}
            if (accept.get("p95_ms") or 0) > 100:
                failures.append(f"RNF-103 server answer accept p95 {accept.get('p95_ms')} ms > 100 ms")
        dropped = [e for p in joined for e in p.errors]
        results["client_errors"] = {e: dropped.count(e) for e in set(dropped)}
        for p in [*joined, host]:
            await p.ws.close()
    results["failures"] = failures
    print(json.dumps(results, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    try:  # the generator's own event loop is the first bottleneck at 2,000 sockets
        import uvloop

        uvloop.install()
    except ImportError:
        pass
    sys.exit(asyncio.run(main()))
