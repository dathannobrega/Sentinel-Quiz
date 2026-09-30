import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClockSync } from "@/features/quiz-live/lib/clock-sync";
import {
  BACKOFF_MAX_MS,
  closeReasonForCode,
  computeBackoffDelay,
  LiveSocket,
  toWebSocketUrl,
  type LiveEnvironment,
  type LiveSocketStatusEvent,
  type WebSocketLike
} from "@/features/quiz-live/lib/live-socket";
import { LIVE_SUBPROTOCOL } from "@/features/quiz-live/lib/protocol";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Array<{ type: string; mid?: string; data: Record<string, unknown> }> = [];
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closedWith: number | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[]
  ) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number) {
    this.closedWith = code ?? 1000;
    this.readyState = 3;
  }

  // helpers
  serverOpen() {
    this.readyState = 1;
    this.onopen?.({});
  }

  serverSend(type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, type, sts: Date.now(), data, ...extra }) });
  }

  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  typesSent() {
    return this.sent.map((frame) => frame.type);
  }
}

function latest(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) {
    throw new Error("no socket");
  }
  return socket;
}

function makeEnvironment() {
  let wake: (() => void) | null = null;
  const environment: LiveEnvironment = {
    onWake(listener) {
      wake = listener;
      return () => {
        wake = null;
      };
    },
    isVisible: () => true
  };
  return { environment, fireWake: () => wake?.() };
}

function makeSocket(overrides: Partial<ConstructorParameters<typeof LiveSocket>[0]> = {}) {
  const env = makeEnvironment();
  const statuses: LiveSocketStatusEvent[] = [];
  const socket = new LiveSocket({
    url: "ws://test/api/live/ws",
    credentials: { kind: "participant", token: "tok" },
    createWebSocket: (url, protocols) => new FakeSocket(url, protocols),
    clock: new ClockSync({ now: () => Date.now() }),
    environment: env.environment,
    random: () => 1,
    ...overrides
  });
  socket.onStatus((event) => statuses.push(event));
  return { socket, statuses, ...env };
}

function welcome(fake: FakeSocket, hbMs = 5000) {
  fake.serverOpen();
  fake.serverSend("welcome", { role: "participant", session_id: "s1", hb_ms: hbMs, proto: 1 });
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("backoff", () => {
  it("retries immediately first, then grows exponentially up to 10 s with full jitter", () => {
    const max = () => 0.999999;
    expect(computeBackoffDelay(1, max)).toBe(0);
    expect(computeBackoffDelay(2, max)).toBe(499);
    expect(computeBackoffDelay(3, max)).toBe(999);
    expect(computeBackoffDelay(4, max)).toBe(1999);
    expect(computeBackoffDelay(20, max)).toBe(BACKOFF_MAX_MS - 1);
    expect(computeBackoffDelay(5, () => 0)).toBe(0);
    for (let index = 0; index < 50; index += 1) {
      const delay = computeBackoffDelay(6);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(8000);
    }
  });

  it("maps close codes and URLs", () => {
    expect(closeReasonForCode(4003)).toBe("kicked");
    expect(closeReasonForCode(1006)).toBe("network");
    expect(toWebSocketUrl("https://x.test/api/live/ws")).toBe("wss://x.test/api/live/ws");
    expect(toWebSocketUrl("http://localhost:3000/api/live/ws")).toBe("ws://localhost:3000/api/live/ws");
  });
});

describe("LiveSocket handshake", () => {
  it("uses the subprotocol, sends hello first and syncs the clock 5 times", () => {
    const { socket, statuses } = makeSocket();
    socket.connect();
    const fake = latest();
    expect(fake.protocols).toEqual([LIVE_SUBPROTOCOL]);
    expect(statuses.at(-1)?.status).toBe("connecting");
    fake.serverOpen();
    expect(fake.sent[0]).toMatchObject({ v: 1, type: "hello", data: { token: "tok" } });
    fake.serverSend("welcome", { role: "participant", session_id: "s1", hb_ms: 5000, proto: 1 });
    expect(statuses.at(-1)?.status).toBe("open");

    for (let index = 0; index < 5; index += 1) {
      const request = fake.sent.at(-1);
      expect(request?.type).toBe("time.sync");
      const t0 = request?.data.t0 as number;
      fake.serverSend("time.sync.reply", { t0, t1: t0 + 10, t2: t0 + 10 });
    }
    expect(fake.typesSent().filter((type) => type === "time.sync")).toHaveLength(5);
    expect(socket.clock.isSynced).toBe(true);
  });

  it("gives up on a connect that never opens and retries", () => {
    const { socket, statuses } = makeSocket({ handshakeTimeoutMs: 2000 });
    socket.connect();
    vi.advanceTimersByTime(2000);
    expect(statuses.some((event) => event.reason === "handshake")).toBe(true);
    vi.advanceTimersByTime(1); // the first retry is immediate (0 ms timer)
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("sends the host hello with session_id and role", () => {
    const { socket } = makeSocket({ credentials: { kind: "host", sessionId: "sess-9" } });
    socket.connect();
    latest().serverOpen();
    expect(latest().sent[0]).toMatchObject({ type: "hello", data: { session_id: "sess-9", role: "host" } });
  });

  it("echoes srv.ping with pong", () => {
    const { socket } = makeSocket();
    socket.connect();
    const fake = latest();
    welcome(fake);
    fake.serverSend("srv.ping", { ts: 42 });
    expect(fake.sent.at(-1)).toMatchObject({ type: "pong", data: { ts: 42 } });
  });

  it("reconnects when welcome does not arrive in time", () => {
    const { socket, statuses } = makeSocket({ handshakeTimeoutMs: 1000 });
    socket.connect();
    latest().serverOpen();
    vi.advanceTimersByTime(1001);
    expect(statuses.some((event) => event.status === "reconnecting" && event.reason === "handshake")).toBe(true);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

describe("LiveSocket reconnection", () => {
  it("retries immediately after the first drop and backs off afterwards", () => {
    const { socket, statuses } = makeSocket({ random: () => 0.5 });
    socket.connect();
    welcome(latest());
    latest().serverClose(1006);
    expect(statuses.at(-1)).toMatchObject({ status: "reconnecting", attempt: 1, retryInMs: 0 });
    vi.advanceTimersByTime(0);
    expect(FakeSocket.instances).toHaveLength(2);
    latest().serverClose(1006);
    expect(statuses.at(-1)).toMatchObject({ status: "reconnecting", attempt: 2, retryInMs: 250 });
    vi.advanceTimersByTime(249);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);
    latest().serverClose(1006);
    expect(statuses.at(-1)).toMatchObject({ attempt: 3, retryInMs: 500 });
    // welcome resets the attempt counter
    vi.advanceTimersByTime(500);
    welcome(latest());
    expect(statuses.at(-1)).toMatchObject({ status: "open", attempt: 0 });
  });

  it("does not reconnect after terminal close codes", () => {
    for (const code of [4001, 4002, 4003, 4004, 4008, 4010, 4011, 1008]) {
      FakeSocket.instances = [];
      const { socket, statuses } = makeSocket();
      socket.connect();
      welcome(latest());
      latest().serverClose(code);
      expect(statuses.at(-1)).toMatchObject({ status: "closed", closeCode: code });
      vi.advanceTimersByTime(60_000);
      expect(FakeSocket.instances).toHaveLength(1);
    }
  });

  it("waits at least 2 s after a rate-limit close", () => {
    const { socket, statuses } = makeSocket();
    socket.connect();
    welcome(latest());
    latest().serverClose(4029);
    expect(statuses.at(-1)).toMatchObject({ status: "reconnecting", reason: "rate_limited" });
    expect(statuses.at(-1)?.retryInMs).toBeGreaterThanOrEqual(2000);
  });

  it("treats 2 × hb_ms without frames as a dead connection", () => {
    const { socket, statuses } = makeSocket();
    socket.connect();
    const fake = latest();
    welcome(fake, 1000);
    vi.advanceTimersByTime(1500);
    fake.serverSend("srv.ping", { ts: 1 }); // re-arms the watchdog
    vi.advanceTimersByTime(1999);
    expect(statuses.at(-1)?.status).toBe("open");
    vi.advanceTimersByTime(1);
    expect(statuses.at(-1)).toMatchObject({ status: "reconnecting", reason: "heartbeat" });
    expect(fake.closedWith).toBe(1000);
  });

  it("skips the remaining backoff when the tab becomes visible or the network returns", () => {
    const { socket, fireWake } = makeSocket({ random: () => 0.99 });
    socket.connect();
    welcome(latest());
    latest().serverClose(1006);
    vi.advanceTimersByTime(0);
    latest().serverClose(1006); // attempt 2 → ~495 ms wait
    const before = FakeSocket.instances.length;
    fireWake();
    expect(FakeSocket.instances.length).toBe(before + 1);
  });

  it("stops everything on close()", () => {
    const { socket, statuses } = makeSocket();
    socket.connect();
    welcome(latest());
    socket.close();
    expect(statuses.at(-1)).toMatchObject({ status: "closed", reason: "manual" });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe("LiveSocket answers outbox", () => {
  it("re-sends an un-acked answer with the same answer_id after reconnecting, until acked", () => {
    const { socket } = makeSocket();
    socket.connect();
    welcome(latest());
    const answerId = socket.submitAnswer({ qi: 2, choice: ["A"] });
    const first = latest().sent.find((frame) => frame.type === "answer.submit");
    expect(first?.data).toMatchObject({ answer_id: answerId, qi: 2, choice: ["A"] });

    latest().serverClose(1006);
    vi.advanceTimersByTime(0);
    welcome(latest());
    const resent = latest().sent.find((frame) => frame.type === "answer.submit");
    expect(resent?.data.answer_id).toBe(answerId);
    expect(socket.pendingAnswers).toBe(1);

    latest().serverSend("answer.ack", { answer_id: answerId, qi: 2, status: "accepted" });
    expect(socket.pendingAnswers).toBe(0);
    const count = latest().sent.length;
    vi.advanceTimersByTime(10_000);
    expect(latest().sent.filter((frame) => frame.type === "answer.submit")).toHaveLength(1);
    expect(latest().sent.length).toBeGreaterThanOrEqual(count);
  });

  it("queues an answer submitted while offline and sends it after welcome", () => {
    const { socket } = makeSocket();
    socket.connect();
    const answerId = socket.submitAnswer({ qi: 0, text: "firewall" });
    expect(latest().typesSent()).not.toContain("answer.submit");
    welcome(latest());
    expect(latest().sent.find((frame) => frame.type === "answer.submit")?.data.answer_id).toBe(answerId);
  });

  it("re-sends on a timer while connected when no ack arrives", () => {
    const { socket } = makeSocket({ answerResendMs: 3000 });
    socket.connect();
    const fake = latest();
    welcome(fake, 60_000);
    socket.submitAnswer({ qi: 1, choice: ["B"] });
    expect(fake.typesSent().filter((type) => type === "answer.submit")).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(fake.typesSent().filter((type) => type === "answer.submit")).toHaveLength(2);
  });

  it("drops pending answers when a snapshot says the question moved on or was answered", () => {
    const { socket } = makeSocket();
    socket.connect();
    socket.submitAnswer({ qi: 1, choice: ["B"] });
    const fake = latest();
    fake.serverOpen();
    fake.serverSend("welcome", { role: "participant", session_id: "s1", hb_ms: 5000, proto: 1 });
    expect(socket.pendingAnswers).toBe(1);
    fake.serverSend("room.snapshot", { qi: 2, my: { answered_current: false } });
    expect(socket.pendingAnswers).toBe(0);
  });
});

describe("LiveSocket send queue", () => {
  it("queues host commands while offline and respects the token bucket", () => {
    const { socket } = makeSocket({ sendRatePerSecond: 5, sendBurst: 2 });
    socket.connect();
    socket.send({ type: "host.start", data: {} });
    socket.send({ type: "host.leaderboard", data: {} });
    socket.send({ type: "host.end", data: {} });
    const fake = latest();
    fake.serverOpen();
    fake.serverSend("welcome", { role: "host", session_id: "s1", hb_ms: 60_000, proto: 1 });
    const hostFrames = () => fake.typesSent().filter((type) => type.startsWith("host."));
    // Burst of 2 tokens: one went to the first time.sync, one to host.start... the rest waits.
    expect(hostFrames().length).toBeLessThan(3);
    vi.advanceTimersByTime(1000);
    expect(hostFrames()).toEqual(["host.start", "host.leaderboard", "host.end"]);
  });

  it("does not queue when asked not to", () => {
    const { socket } = makeSocket();
    socket.connect();
    socket.send({ type: "host.start", data: {} }, { queueWhileOffline: false });
    welcome(latest());
    expect(latest().typesSent()).not.toContain("host.start");
  });

  it("marks the connection terminal when kicked", () => {
    const { socket, statuses } = makeSocket();
    socket.connect();
    welcome(latest());
    latest().serverSend("participant.kicked", { banned: false });
    latest().serverClose(1000);
    expect(statuses.at(-1)).toMatchObject({ status: "closed", reason: "kicked" });
  });
});
