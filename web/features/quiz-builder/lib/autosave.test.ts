import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAutosaver, mergePatch, type Patch } from "@/features/quiz-builder/lib/autosave";
import { createSerialQueue } from "@/lib/utils/serial-queue";

class ConflictError extends Error {}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mergePatch", () => {
  it("merges shallowly and one level deep for plain objects", () => {
    expect(mergePatch({ title: "a", settings: { music: true } }, { settings: { grace_ms: 10 } })).toEqual({
      title: "a",
      settings: { music: true, grace_ms: 10 }
    });
    expect(mergePatch({ options: [1, 2] }, { options: [3] })).toEqual({ options: [3] });
  });
});

describe("createSerialQueue", () => {
  it("runs tasks one at a time in FIFO order and survives failures", async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    const first = deferred();
    const a = queue.enqueue(async () => {
      log.push("a:start");
      await first.promise;
      log.push("a:end");
      throw new Error("a failed");
    });
    const b = queue.enqueue(async () => {
      log.push("b");
      return 2;
    });
    expect(queue.size).toBe(2);
    await Promise.resolve();
    expect(log).toEqual(["a:start"]);
    first.resolve();
    await expect(a).rejects.toThrow("a failed");
    await expect(b).resolves.toBe(2);
    expect(log).toEqual(["a:start", "a:end", "b"]);
    await queue.idle();
    expect(queue.size).toBe(0);
  });

  it("each task sees the version produced by the previous one", async () => {
    const queue = createSerialQueue();
    let version = 1;
    const seen: number[] = [];
    const bump = () =>
      queue.enqueue(async () => {
        seen.push(version);
        await new Promise((resolve) => setTimeout(resolve, 1));
        version += 1;
      });
    await Promise.all([bump(), bump(), bump()]);
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("createAutosaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces and merges patches per key", async () => {
    const save = vi.fn(async (_key: string, _patch: Patch) => undefined);
    const saver = createAutosaver({ delayMs: 800, save });
    saver.schedule("i1", { prompt: "a" });
    vi.advanceTimersByTime(500);
    saver.schedule("i1", { prompt: "ab", time_limit_s: 20 });
    saver.schedule("i2", { prompt: "x" });
    expect(saver.getSnapshot().status).toBe("pending");
    vi.advanceTimersByTime(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith("i1", { prompt: "ab", time_limit_s: 20 });
    expect(save).toHaveBeenCalledWith("i2", { prompt: "x" });
    expect(saver.getSnapshot().status).toBe("saved");
    expect(saver.getSnapshot().pending).toEqual({});
  });

  it("keeps edits typed while a save is in flight as a separate pending patch", async () => {
    const inflight = deferred();
    const save = vi.fn(() => inflight.promise);
    const saver = createAutosaver({ delayMs: 800, save });
    saver.schedule("i1", { prompt: "a" });
    await vi.advanceTimersByTimeAsync(800);
    expect(saver.getSnapshot().status).toBe("saving");
    expect(saver.getSnapshot().inflight).toEqual({ i1: { prompt: "a" } });
    saver.schedule("i1", { prompt: "ab" });
    expect(saver.getSnapshot().pending).toEqual({ i1: { prompt: "ab" } });
    inflight.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.getSnapshot().inflight).toEqual({});
    expect(saver.getSnapshot().pending).toEqual({ i1: { prompt: "ab" } });
  });

  it("serializes saves through a SerialQueue (no overlapping requests)", async () => {
    const queue = createSerialQueue();
    let running = 0;
    let maxRunning = 0;
    const save = vi.fn((_key: string, _patch: Patch) =>
      queue.enqueue(async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 50));
        running -= 1;
      })
    );
    const saver = createAutosaver({ delayMs: 10, save });
    saver.schedule("a", { prompt: "1" });
    saver.schedule("b", { prompt: "2" });
    saver.schedule("quiz", { title: "t" });
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(3);
    expect(maxRunning).toBe(1);
  });

  it("puts a failed patch back under newer edits and reports error; retry via flush", async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error("network");
    });
    const saver = createAutosaver({ delayMs: 100, save });
    saver.schedule("i1", { prompt: "a", body: "x" });
    await vi.advanceTimersByTimeAsync(100);
    expect(saver.getSnapshot().status).toBe("error");
    expect(saver.getSnapshot().pending).toEqual({ i1: { prompt: "a", body: "x" } });
    fail = false;
    await saver.resume();
    expect(save).toHaveBeenLastCalledWith("i1", { prompt: "a", body: "x" });
    expect(saver.getSnapshot().status).toBe("saved");
  });

  it("pauses on a version conflict until resumed or discarded", async () => {
    let conflict = true;
    const save = vi.fn(async () => {
      if (conflict) throw new ConflictError("409");
    });
    const saver = createAutosaver({ delayMs: 100, save, isConflict: (error) => error instanceof ConflictError });
    saver.schedule("i1", { prompt: "mine" });
    await vi.advanceTimersByTimeAsync(100);
    expect(saver.getSnapshot().status).toBe("conflict");
    expect(saver.getSnapshot().paused).toBe(true);

    // Further typing accumulates but does not fire while paused.
    saver.schedule("i1", { prompt: "mine2" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);

    conflict = false;
    await saver.resume();
    expect(save).toHaveBeenLastCalledWith("i1", { prompt: "mine2" });
    expect(saver.getSnapshot().status).toBe("saved");
  });

  it("discard drops unsaved edits and leaves the conflict state", async () => {
    const save = vi.fn(async () => {
      throw new ConflictError("409");
    });
    const saver = createAutosaver({ delayMs: 100, save, isConflict: (error) => error instanceof ConflictError });
    saver.schedule("i1", { prompt: "mine" });
    await vi.advanceTimersByTimeAsync(100);
    saver.discard();
    expect(saver.getSnapshot()).toMatchObject({ status: "idle", paused: false, pending: {} });
  });

  it("holds patches that break a hard limit (blocked) without calling save", async () => {
    const save = vi.fn(async () => undefined);
    const saver = createAutosaver<Patch>({
      delayMs: 100,
      save,
      canSave: (_key, patch) => String(patch.prompt ?? "").length <= 5
    });
    saver.schedule("i1", { prompt: "too long!" });
    expect(saver.getSnapshot().status).toBe("blocked");
    await vi.advanceTimersByTimeAsync(200);
    expect(save).not.toHaveBeenCalled();
    saver.schedule("i1", { prompt: "ok" });
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledWith("i1", { prompt: "ok" });
  });

  it("flush saves immediately and notifies subscribers", async () => {
    const save = vi.fn(async () => undefined);
    const saver = createAutosaver({ delayMs: 10_000, save });
    const listener = vi.fn();
    saver.subscribe(listener);
    saver.schedule("i1", { prompt: "a" });
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
