"""Load test of the waiting room (Incremento 7, DC-16): N people join a room capped below
N from one IP; the overflow waits, polling at the pace the server asks for
(``retry_after_ms``), until the host raises the cap over the WebSocket. Measures the join
storm (201 seated / 202 waiting, no 429 or 5xx), the poll rate while waiting and how fast
everyone gets a seat after the host's command.

    python scripts/live/waiting_room_load.py --participants 2000 --cap 1800
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import ssl
import sys
import time
import uuid

import httpx
import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loadtest import SUBPROTOCOL, frame, summary  # noqa: E402


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--participants", type=int, default=600)
    ap.add_argument("--cap", type=int, default=500)
    ap.add_argument("--concurrency", type=int, default=200)
    ap.add_argument("--wait-before-raise", type=float, default=20.0, help="seconds the overflow waits before the host raises the cap")
    ap.add_argument("--origin", default="http://localhost:3000")
    ap.add_argument("--insecure", action="store_true")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    failures: list[str] = []
    verify = not args.insecure
    limits = httpx.Limits(max_connections=args.concurrency, max_keepalive_connections=args.concurrency)
    async with httpx.AsyncClient(base_url=base, timeout=60, verify=verify, limits=limits) as http:
        email = f"waiting-{uuid.uuid4().hex[:8]}@example.com"
        await http.post("/api/auth/register", json={"email": email, "password": "correct-horse-battery"})
        (await http.post("/api/auth/login", json={"email": email, "password": "correct-horse-battery"})).raise_for_status()
        quiz = (await http.post("/api/live/quizzes", json={"title": "Sala de espera"})).json()
        quiz = (await http.post(f"/api/live/quizzes/{quiz['id']}/items", json={
            "expected_version": quiz["version"], "item_type": "single_choice", "prompt": "Pronto?",
            "options": [{"text": "Sim", "correct": True}, {"text": "Não"}], "time_limit_s": 30,
        })).json()
        (await http.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})).raise_for_status()
        session = (await http.post("/api/live/sessions", json={"quiz_id": quiz["id"], "max_participants": args.cap})).json()
        code = session["join_code"]
        cookies = "; ".join(f"{k}={v}" for k, v in http.cookies.items())

    sem = asyncio.Semaphore(args.concurrency)
    statuses: dict[str, int] = {}
    join_ms: list[float] = []
    waiting: list[dict] = []
    polls = 0
    seated_at: dict[str, float] = {}
    raise_at: list[float] = []

    async with httpx.AsyncClient(base_url=base, timeout=60, verify=verify, limits=limits) as guests:
        async def join(i: int) -> None:
            async with sem:
                t0 = time.perf_counter()
                r = await guests.post(f"/api/live/rooms/{code}/join", json={"display_name": f"Fila {i:05d}", "consent": True})
                join_ms.append((time.perf_counter() - t0) * 1000)
            statuses[str(r.status_code)] = statuses.get(str(r.status_code), 0) + 1
            if r.status_code == 202:
                waiting.append(r.json())

        t0 = time.perf_counter()
        await asyncio.gather(*(join(i) for i in range(args.participants)))
        storm_s = time.perf_counter() - t0

        async def wait_for_seat(ticket: dict) -> None:
            nonlocal polls
            delay = ticket["retry_after_ms"] / 1000
            while True:
                await asyncio.sleep(delay)
                async with sem:
                    r = await guests.get(f"/api/live/queue/{ticket['request_id']}", headers={"Authorization": f"Bearer {ticket['wait_token']}"})
                polls += 1
                body = r.json()
                if body.get("status") == "admitted":
                    seated_at[ticket["request_id"]] = time.perf_counter()
                    return
                if body.get("status") != "waiting":
                    statuses["poll_" + str(body.get("status") or r.status_code)] = statuses.get("poll_" + str(body.get("status")), 0) + 1
                    return
                delay = body["retry_after_ms"] / 1000

        async def host_raises() -> None:
            await asyncio.sleep(args.wait_before_raise)
            ctx = ssl._create_unverified_context() if args.insecure else None  # noqa: SLF001
            ws_url = base.replace("http", "ws", 1) + "/api/live/ws"
            async with websockets.connect(ws_url, subprotocols=[SUBPROTOCOL], additional_headers={"Cookie": cookies, "Origin": args.origin}, ssl=ctx if ws_url.startswith("wss") else None) as ws:
                await ws.send(frame("hello", {"session_id": session["id"], "role": "host"}))
                raise_at.append(time.perf_counter())
                await ws.send(frame("host.set_capacity", {"max_participants": args.participants}))
                await asyncio.sleep(1)

        t_wait = time.perf_counter()
        await asyncio.gather(host_raises(), *(wait_for_seat(t) for t in waiting))
        waited_s = time.perf_counter() - t_wait

    seat_delays = sorted((t - raise_at[0]) * 1000 for t in seated_at.values()) if raise_at else []
    result = {
        "participants": args.participants, "cap": args.cap, "join_storm_s": round(storm_s, 2),
        "join_status": statuses, "join_latency_ms": summary(join_ms),
        "waited": len(waiting), "seated_after_raise": len(seated_at),
        "polls": polls, "poll_rate_per_s": round(polls / max(waited_s, 0.001), 1),
        "seat_after_raise_ms": summary(seat_delays),
    }
    expected_wait = max(0, args.participants - args.cap)
    if statuses.get("201", 0) != args.cap or len(waiting) != expected_wait:
        failures.append(f"expected {args.cap} seated and {expected_wait} waiting, got {statuses}")
    if any(k.startswith("4") and k != "409" or k.startswith("5") for k in statuses if k[0].isdigit()):
        failures.append(f"errors in the join storm: {statuses}")
    if len(seated_at) != expected_wait:
        failures.append(f"only {len(seated_at)}/{expected_wait} got a seat after the cap was raised")
    result["failures"] = failures
    print(json.dumps(result, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
