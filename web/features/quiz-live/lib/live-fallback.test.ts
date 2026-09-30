import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClockSync } from "@/features/quiz-live/lib/clock-sync";
import {
  buildCmdBody,
  buildCmdInit,
  buildSseUrl,
  interpretCmdResponse,
  parseSseClose,
  postLiveCommand,
  shouldFallbackToSse,
  type EventSourceLike,
  type FetchLike
} from "@/features/quiz-live/lib/live-fallback";
import { LiveSocket, type LiveCredentials, type LiveSocketStatusEvent, type WebSocketLike } from "@/features/quiz-live/lib/live-socket";
import type { ServerMessage } from "@/features/quiz-live/lib/protocol";

// ----------------------------------------------------------------------------- fakes

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send() {}

  close() {
    this.readyState = 3;
  }

  serverOpen() {
    this.readyState = 1;
    this.onopen?.({});
  }

  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  serverSend(type: string, data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, type, sts: Date.now(), data }) });
  }
}

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private closeListeners: Array<(event: { data: unknown }) => void> = [];

  constructor(
    readonly url: string,
    readonly init: { withCredentials: boolean }
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(_type: "close", listener: (event: { data: unknown }) => void) {
    this.closeListeners.push(listener);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  frame(type: string, data: Record<string, unknown>) {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify({ v: 1, type, sts: Date.now(), data }) });
  }

  welcome(role = "participant") {
    this.frame("welcome", { role, session_id: "s1", hb_ms: 15000, proto: 1, transport: "sse" });
  }

  serverClose(code: number) {
    for (const listener of this.closeListeners) {
      listener({ data: JSON.stringify({ code }) });
    }
  }

  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.({});
  }
}

function latestSource(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (!source) {
    throw new Error("no event source");
  }
  return source;
}

interface FetchCall {
  url: string;
  init: RequestInit;
  body: { auth: Record<string, unknown>; frame: { type: string; mid?: string; data: Record<string, unknown> } };
}

function makeFetch(respond: (call: FetchCall) => { status: number; body: unknown } = () => ({ status: 200, body: { frames: [] } })) {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchLike = vi.fn(async (url: string, init: RequestInit) => {
    const call: FetchCall = { url, init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    const { status, body } = respond(call);
    return { status, json: async () => body };
  });
  return { fetchImpl, calls };
}

function makeClient(options: { credentials?: LiveCredentials; fetchImpl?: FetchLike; online?: boolean } = {}) {
  const statuses: LiveSocketStatusEvent[] = [];
  const messages: ServerMessage[] = [];
  const socket = new LiveSocket({
    url: "ws://test/api/live/ws",
    credentials: options.credentials ?? { kind: "participant", token: "tok" },
    createWebSocket: (url) => new FakeSocket(url),
    clock: new ClockSync({ now: () => Date.now() }),
    environment: null,
    random: () => 1,
    fallback: {
      sseUrl: "https://api.test/api/live/sse",
      cmdUrl: "https://api.test/api/live/cmd",
      createEventSource: (url, init) => new FakeEventSource(url, init),
      fetch: options.fetchImpl ?? makeFetch().fetchImpl,
      isOnline: () => options.online ?? true
    }
  });
  socket.onStatus((event) => statuses.push(event));
  socket.onMessage((message) => messages.push(message));
  return { socket, statuses, messages };
}

async function flush() {
  // Let the fetch promise chains (fetch → json → handler) settle under fake timers.
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  FakeEventSource.instances = [];
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

// ----------------------------------------------------------------------------- pure helpers

describe("shouldFallbackToSse", () => {
  const online = { online: true, everWelcomed: false };

  it("falls back when the socket could not open", () => {
    expect(shouldFallbackToSse([{ opened: false, durationMs: 300 }], online)).toBe(true);
  });

  it("falls back after two quick drops before welcome, not after one", () => {
    expect(shouldFallbackToSse([{ opened: true, durationMs: 1200 }], online)).toBe(false);
    expect(
      shouldFallbackToSse(
        [
          { opened: true, durationMs: 1200 },
          { opened: true, durationMs: 4800 }
        ],
        online
      )
    ).toBe(true);
  });

  it("does not count slow drops", () => {
    expect(
      shouldFallbackToSse(
        [
          { opened: true, durationMs: 1200 },
          { opened: true, durationMs: 7000 }
        ],
        online
      )
    ).toBe(false);
  });

  it("never falls back while offline", () => {
    expect(shouldFallbackToSse([{ opened: false, durationMs: 0 }], { online: false, everWelcomed: false })).toBe(false);
  });

  it("treats a refused socket after an earlier welcome as a restart", () => {
    const context = { online: true, everWelcomed: true };
    expect(shouldFallbackToSse([{ opened: false, durationMs: 100 }], context)).toBe(false);
    expect(
      shouldFallbackToSse(
        [
          { opened: false, durationMs: 100 },
          { opened: false, durationMs: 100 }
        ],
        context
      )
    ).toBe(true);
  });
});

describe("request building", () => {
  it("authenticates the stream by token or host session", () => {
    expect(buildSseUrl("https://a.test/api/live/sse", { kind: "participant", token: "a b" })).toBe("https://a.test/api/live/sse?token=a+b");
    expect(buildSseUrl("https://a.test/api/live/sse", { kind: "host", sessionId: "s-1" })).toBe(
      "https://a.test/api/live/sse?session_id=s-1&role=host"
    );
  });

  it("wraps the frame with its auth and headers", () => {
    const participant: LiveCredentials = { kind: "participant", token: "tok" };
    const body = buildCmdBody(participant, { type: "host.pause", data: { expected_qi: 2 } }, "mid-1");
    expect(body).toEqual({ auth: { token: "tok" }, frame: { v: 1, type: "host.pause", mid: "mid-1", data: { expected_qi: 2 } } });
    const init = buildCmdInit(participant, body);
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(init.credentials).toBe("omit");

    const host: LiveCredentials = { kind: "host", sessionId: "s-1" };
    const hostInit = buildCmdInit(host, buildCmdBody(host, { type: "host.start", data: {} }));
    expect(JSON.parse(String(hostInit.body)).auth).toEqual({ session_id: "s-1", role: "host" });
    expect(hostInit.credentials).toBe("include");
    expect(hostInit.headers).not.toHaveProperty("Authorization");
  });
});

describe("interpretCmdResponse", () => {
  it("returns valid frames and drops malformed ones", () => {
    const outcome = interpretCmdResponse(200, {
      frames: [{ v: 1, type: "answer.ack", sts: 1, data: { answer_id: "a", qi: 0, status: "paused" } }, { v: 1, type: "bogus", sts: 1, data: {} }, null]
    });
    expect(outcome.kind).toBe("frames");
    expect(outcome.kind === "frames" && outcome.frames.map((frame) => frame.type)).toEqual(["answer.ack"]);
  });

  it("maps live_auth to the close code", () => {
    expect(interpretCmdResponse(403, { code: "live_auth", details: { close_code: 4004 } })).toEqual({ kind: "auth", closeCode: 4004 });
    expect(interpretCmdResponse(401, null)).toEqual({ kind: "auth", closeCode: 4001 });
    expect(interpretCmdResponse(429, {})).toEqual({ kind: "rate_limited" });
    expect(interpretCmdResponse(502, {})).toEqual({ kind: "failed", status: 502 });
  });

  it("never throws on network errors", async () => {
    const failing: FetchLike = () => Promise.reject(new TypeError("offline"));
    await expect(postLiveCommand(failing, "u", { kind: "participant", token: "t" }, { type: "host.start", data: {} })).resolves.toEqual({
      kind: "failed",
      status: 0
    });
  });

  it("parses the close event payload", () => {
    expect(parseSseClose('{"code": 1012}')).toBe(1012);
    expect(parseSseClose("nope")).toBeNull();
  });
});

// ----------------------------------------------------------------------------- LiveSocket integration

describe("LiveSocket SSE fallback", () => {
  it("switches to SSE when the socket cannot open and reports the transport", () => {
    const { socket, statuses } = makeClient();
    socket.connect();
    FakeSocket.instances[0].serverClose(1006);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latestSource().url).toBe("https://api.test/api/live/sse?token=tok");
    expect(latestSource().init.withCredentials).toBe(false);
    expect(socket.getTransport()).toBe("sse");

    latestSource().welcome();
    expect(statuses.at(-1)).toMatchObject({ status: "open", transport: "sse" });
  });

  it("switches after two quick drops before welcome", () => {
    const { socket } = makeClient();
    socket.connect();
    FakeSocket.instances[0].serverOpen();
    vi.advanceTimersByTime(500);
    FakeSocket.instances[0].serverClose(1006);
    vi.advanceTimersByTime(1); // immediate first retry
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeEventSource.instances).toHaveLength(0);
    FakeSocket.instances[1].serverOpen();
    vi.advanceTimersByTime(800);
    FakeSocket.instances[1].serverClose(1006);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(socket.getTransport()).toBe("sse");
  });

  it("keeps the WebSocket when it drops after welcome", () => {
    const { socket } = makeClient();
    socket.connect();
    const first = FakeSocket.instances[0];
    first.serverOpen();
    first.serverSend("welcome", { role: "participant", session_id: "s1", hb_ms: 5000, proto: 1 });
    first.serverClose(1006);
    vi.advanceTimersByTime(1);
    FakeSocket.instances[1].serverClose(1006); // refused once after a welcome: a restart, not a proxy
    expect(socket.getTransport()).toBe("ws");
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("uses the host session and cookie on the stream", () => {
    const { socket } = makeClient({ credentials: { kind: "host", sessionId: "sess-9" } });
    socket.connect();
    FakeSocket.instances[0].serverClose(1006);
    expect(latestSource().url).toBe("https://api.test/api/live/sse?session_id=sess-9&role=host");
    expect(latestSource().init.withCredentials).toBe(true);
  });

  it("posts commands and feeds the response frames to the listeners", async () => {
    const { fetchImpl, calls } = makeFetch((call) =>
      call.body.frame.type === "answer.submit"
        ? {
            status: 200,
            body: { frames: [{ v: 1, type: "answer.ack", sts: Date.now(), data: { answer_id: call.body.frame.data.answer_id, qi: 0, status: "accepted" } }] }
          }
        : { status: 200, body: { frames: [] } }
    );
    const { socket, messages } = makeClient({ fetchImpl });
    socket.connect();
    FakeSocket.instances[0].serverClose(1006);
    latestSource().welcome();
    await flush();

    const answerId = socket.submitAnswer({ qi: 0, choice: ["A"] });
    expect(socket.hasPendingAnswer(answerId)).toBe(true);
    await flush();
    const submit = calls.find((call) => call.body.frame.type === "answer.submit");
    expect(submit?.url).toBe("https://api.test/api/live/cmd");
    expect(submit?.body.auth).toEqual({ token: "tok" });
    expect(submit?.body.frame).toMatchObject({ v: 1, data: { answer_id: answerId, qi: 0, choice: ["A"] } });
    expect(messages.some((message) => message.type === "answer.ack")).toBe(true);
    expect(socket.hasPendingAnswer(answerId)).toBe(false);
    // `hello` is implicit on the stream and never posted.
    expect(calls.some((call) => call.body.frame.type === "hello")).toBe(false);
  });

  it("closes for good when a command is refused as kicked", async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 403, body: { code: "live_auth", details: { close_code: 4003 } } }));
    const { socket, statuses } = makeClient({ fetchImpl, credentials: { kind: "host", sessionId: "s" } });
    socket.connect();
    FakeSocket.instances[0].serverClose(1006);
    latestSource().welcome("host");
    socket.send({ type: "host.pause", data: { expected_qi: 0 } });
    await flush();
    expect(statuses.at(-1)).toMatchObject({ status: "closed", reason: "kicked", closeCode: 4003 });
    expect(latestSource().closed).toBe(true);
  });

  it("treats the close event like a socket close code", () => {
    const { socket, statuses } = makeClient();
    socket.connect();
    FakeSocket.instances[0].serverClose(1006);
    const first = latestSource();
    first.welcome();

    first.serverClose(1012); // recycled stream: reconnect at once
    expect(first.closed).toBe(true);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    latestSource().welcome();
    latestSource().serverClose(4004);
    expect(statuses.at(-1)).toMatchObject({ status: "closed", reason: "banned", closeCode: 4004, transport: "sse" });
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("asks /cmd why a stream was refused before it said welcome", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 401, body: { code: "live_auth", details: { close_code: 4002 } } }));
    const { socket, statuses } = makeClient({ fetchImpl });
    socket.connect();
    FakeSocket.instances[0].serverClose(1006);
    latestSource().fail(2);
    await flush();
    expect(calls[0]?.body.frame.type).toBe("time.sync");
    expect(statuses.at(-1)).toMatchObject({ status: "closed", reason: "token_expired" });
  });

  it("does not fall back while offline", () => {
    const { socket } = makeClient({ online: false });
    socket.connect();
    FakeSocket.instances[0].serverClose(1006);
    expect(socket.getTransport()).toBe("ws");
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
