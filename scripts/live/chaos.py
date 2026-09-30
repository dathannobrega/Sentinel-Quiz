"""Sentinel Arena chaos checks (PLANO §16 ④, RNF-302/304/305).

N participants play one question while the platform is hurt mid-question:

* ``--scenario worker``: ``kill -9`` one API worker (``--kill-pid``, or the first child of
  ``--supervisor-pid``). Its sockets drop; clients reconnect like the real one (backoff,
  ``hello`` with the same token, the pending answer re-sent with the same ``answer_id``).
* ``--scenario redis``: restart Redis (``--redis-restart-cmd``) while answers arrive. The
  bus must recover and the reveal must still reach everyone.

Pass criteria: every participant ends with an ack for its answer (accepted/duplicate: no
ack is lost), every reconnect completes in ≤5 s (RNF-302), and every participant gets the
reveal. Prints JSON; exit 1 on failure.

    python scripts/live/chaos.py --scenario worker --supervisor-pid <uvicorn pid> --participants 300
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import uuid

import httpx
import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loadtest import SUBPROTOCOL, frame, summary  # noqa: E402


class Phone:
    """A participant client with the reconnect behaviour of web/features/quiz-live."""

    def __init__(self, index: int, token: str, ws_url: str) -> None:
        self.index = index
        self.token = token
        self.ws_url = ws_url
        self.ws = None
        self.intro: dict | None = None
        self.answer_id = str(uuid.uuid4())
        self.answer_frame: str | None = None
        self.ack: str | None = None
        self.revealed = False
        self.drops = 0
        self.reconnect_ms: list[float] = []
        self.task: asyncio.Task | None = None
        self.stop = False

    async def run(self) -> None:
        backoff = 0.2
        while not self.stop:
            dropped_at = time.perf_counter() if self.drops else None
            try:
                async with websockets.connect(self.ws_url, subprotocols=[SUBPROTOCOL], open_timeout=10, max_size=2**20) as ws:
                    self.ws = ws
                    await ws.send(frame("hello", {"token": self.token}))
                    async for raw in ws:
                        msg = json.loads(raw)
                        kind = msg["type"]
                        if kind == "srv.ping":
                            await ws.send(frame("pong", {"ts": msg["data"]["ts"]}))
                        elif kind == "room.snapshot":
                            if dropped_at is not None:
                                self.reconnect_ms.append((time.perf_counter() - dropped_at) * 1000)
                                dropped_at = None
                            backoff = 0.2
                            data = msg["data"]
                            if data.get("question") and self.intro is None:
                                self.intro = {"qi": data["qi"], "question": data["question"]}
                            if data.get("phase") == "reveal":
                                self.revealed = True
                            # Resume: the answer was sent but never acked -> send it again.
                            if self.answer_frame and self.ack is None and not (data.get("my") or {}).get("answered_current"):
                                await ws.send(self.answer_frame)
                            elif self.answer_frame and self.ack is None:
                                self.ack = "accepted(resumed)"
                        elif kind == "question.intro":
                            self.intro = msg["data"]
                        elif kind == "answer.ack":
                            self.ack = msg["data"]["status"]
                        elif kind == "question.reveal":
                            self.revealed = True
            except Exception:
                pass
            if self.stop:
                return
            self.drops += 1
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 2.0)

    async def answer(self) -> None:
        for _ in range(100):
            if self.intro:
                break
            await asyncio.sleep(0.1)
        question = self.intro["question"]
        choice = question["options"][0]["id"]
        self.answer_frame = frame("answer.submit", {"answer_id": self.answer_id, "qi": self.intro["qi"], "choice": [choice]})
        for _ in range(50):
            try:
                await self.ws.send(self.answer_frame)
                return
            except Exception:
                await asyncio.sleep(0.2)  # reconnecting: the resume path re-sends it


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--participants", type=int, default=300)
    ap.add_argument("--scenario", choices=["worker", "redis"], required=True)
    ap.add_argument("--kill-pid", type=int, default=0)
    ap.add_argument("--supervisor-pid", type=int, default=0)
    ap.add_argument("--redis-restart-cmd", default="redis-cli shutdown nosave; sleep 2; redis-server --port 6379 --save '' --appendonly no --daemonize yes")
    ap.add_argument("--origin", default="http://localhost:3000")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    ws_url = base.replace("http", "ws", 1) + "/api/live/ws"
    failures: list[str] = []

    async with httpx.AsyncClient(base_url=base, timeout=30) as http:
        email = f"chaos-{uuid.uuid4().hex[:8]}@example.com"
        await http.post("/api/auth/register", json={"email": email, "password": "correct-horse-battery"})
        (await http.post("/api/auth/login", json={"email": email, "password": "correct-horse-battery"})).raise_for_status()
        quiz = (await http.post("/api/live/quizzes", json={"title": "Chaos", "settings": {"reading_phase_s": 0, "leaderboard_every": 0}})).json()
        quiz = (await http.post(f"/api/live/quizzes/{quiz['id']}/items", json={
            "expected_version": quiz["version"], "item_type": "single_choice", "prompt": "Caos?", "time_limit_s": 60,
            "options": [{"text": "Sim", "correct": True}, {"text": "Não"}]})).json()
        (await http.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})).raise_for_status()
        session = (await http.post("/api/live/sessions", json={"quiz_id": quiz["id"], "max_participants": args.participants})).json()
        code = session["join_code"]
        sem = asyncio.Semaphore(100)

        async with httpx.AsyncClient(base_url=base, timeout=30) as guests:  # no host cookie: real guests
            async def join(i: int) -> str:
                async with sem:
                    r = await guests.post(f"/api/live/rooms/{code}/join", json={"display_name": f"Caos {i:04d}", "consent": True})
                    r.raise_for_status()
                    return r.json()["token"]

            tokens = await asyncio.gather(*(join(i) for i in range(args.participants)))
        phones = [Phone(i, t, ws_url) for i, t in enumerate(tokens)]
        for phone in phones:
            phone.task = asyncio.create_task(phone.run())
        await asyncio.sleep(max(3.0, args.participants / 100))
        cookies = "; ".join(f"{k}={v}" for k, v in http.cookies.items())
        host = await websockets.connect(ws_url, subprotocols=[SUBPROTOCOL], additional_headers={"Cookie": cookies, "Origin": args.origin})
        await host.send(frame("hello", {"session_id": session["id"], "role": "host"}))
        await host.send(frame("host.start"))
        await asyncio.sleep(1.5)

        # Half answer, then chaos, then the other half answers while the platform recovers.
        half = len(phones) // 2
        await asyncio.gather(*(p.answer() for p in phones[:half]))
        chaos_at = time.perf_counter()
        if args.scenario == "worker":
            pid = args.kill_pid
            if not pid and args.supervisor_pid:
                children = subprocess.run(["pgrep", "-P", str(args.supervisor_pid)], capture_output=True, text=True).stdout.split()
                pid = int(children[-1]) if children else 0
            if not pid:
                print(json.dumps({"error": "no worker pid"}))
                return 1
            os.kill(pid, signal.SIGKILL)
        else:
            subprocess.run(args.redis_restart_cmd, shell=True, check=False)
        await asyncio.gather(*(p.answer() for p in phones[half:]))

        # Wait for every ack (resumed ones included), then reveal.
        deadline = time.perf_counter() + 30
        while time.perf_counter() < deadline and any(p.ack is None for p in phones):
            await asyncio.sleep(0.2)
        acked_s = time.perf_counter() - chaos_at
        try:
            await host.send(frame("host.reveal", {"expected_qi": 0}))
        except Exception:  # the host's own socket may have been on the killed worker
            host = await websockets.connect(ws_url, subprotocols=[SUBPROTOCOL], additional_headers={"Cookie": cookies, "Origin": args.origin})
            await host.send(frame("hello", {"session_id": session["id"], "role": "host"}))
            await asyncio.sleep(0.5)
            await host.send(frame("host.reveal", {"expected_qi": 0}))
        deadline = time.perf_counter() + 20
        while time.perf_counter() < deadline and not all(p.revealed for p in phones):
            await asyncio.sleep(0.2)
        report = (await http.get(f"/api/live/sessions/{session['id']}/report")).json()

    for phone in phones:
        phone.stop = True
    reconnects = [ms for p in phones for ms in p.reconnect_ms]
    statuses: dict[str, int] = {}
    for phone in phones:
        statuses[str(phone.ack)] = statuses.get(str(phone.ack), 0) + 1
    result = {
        "scenario": args.scenario, "participants": len(phones), "dropped": sum(1 for p in phones if p.drops),
        "reconnect_ms": summary(reconnects), "acks": statuses, "all_acked_after_s": round(acked_s, 2),
        "revealed": sum(1 for p in phones if p.revealed),
        "stored_answers": report.get("items", [{}])[0].get("answered"),
    }
    if statuses.get("None"):
        failures.append(f"lost acks: {statuses['None']}")
    if reconnects and max(reconnects) > 5000:
        failures.append(f"RNF-302 reconnect max {max(reconnects):.0f} ms > 5 s")
    if result["revealed"] != len(phones):
        failures.append(f"reveal reached {result['revealed']}/{len(phones)}")
    if result["stored_answers"] != len(phones):
        failures.append(f"stored answers {result['stored_answers']}/{len(phones)}")
    result["failures"] = failures
    print(json.dumps(result, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
