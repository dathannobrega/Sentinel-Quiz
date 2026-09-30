/**
 * Debounced, per-target autosave.
 *
 * - `schedule(key, patch)` merges the patch into what is pending for that key and (re)starts a
 *   timer; when it fires, the merged patch moves to "in flight" and `save` is called.
 * - `save` is expected to go through the SerialQueue, so saves never overlap on the server.
 * - The UI renders `server ⊕ inflight ⊕ pending`, so typing never waits for the network and a
 *   response never clobbers keystrokes made meanwhile.
 * - On error the in-flight patch is merged back under the pending one (nothing is lost).
 *   A version conflict pauses autosave until the user decides (resume = apply on top, or discard).
 * - `canSave` lets the editor hold a patch that breaks a hard limit (e.g. prompt > 400 chars).
 */

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "blocked" | "error" | "conflict";

export type Patch = Record<string, unknown>;

export interface AutosaveSnapshot<P extends Patch> {
  status: AutosaveStatus;
  pending: Readonly<Record<string, P>>;
  inflight: Readonly<Record<string, P>>;
  error: unknown;
  paused: boolean;
}

export interface AutosaverOptions<P extends Patch> {
  delayMs: number;
  save: (key: string, patch: P) => Promise<void>;
  merge?: (base: P, next: P) => P;
  canSave?: (key: string, patch: P) => boolean;
  isConflict?: (error: unknown) => boolean;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Autosaver<P extends Patch> {
  schedule(key: string, patch: P): void;
  /** Saves now (all keys, or one). Resolves when those saves settle. */
  flush(key?: string): Promise<void>;
  /** Drops unsaved changes (all keys, or one). Does not cancel requests already sent. */
  discard(key?: string): void;
  /** Leaves the conflict/error state and saves what is pending. */
  resume(): Promise<void>;
  /** Re-evaluate `canSave` after the editor fixed a blocking error. */
  revalidate(): void;
  getSnapshot(): AutosaveSnapshot<P>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** Shallow merge, with one level of nesting for plain objects (quiz `settings`). */
export function mergePatch<P extends Patch>(base: P, next: P): P {
  const result: Patch = { ...base };
  for (const [key, value] of Object.entries(next)) {
    const previous = result[key];
    if (isPlainObject(previous) && isPlainObject(value)) {
      result[key] = { ...previous, ...value };
    } else {
      result[key] = value;
    }
  }
  return result as P;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAutosaver<P extends Patch>(options: AutosaverOptions<P>): Autosaver<P> {
  const merge = options.merge ?? mergePatch;
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const isConflict = options.isConflict ?? (() => false);

  let pending: Record<string, P> = {};
  let inflight: Record<string, P> = {};
  let status: AutosaveStatus = "idle";
  let error: unknown = null;
  let paused = false;
  let disposed = false;
  const timers = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  let snapshot: AutosaveSnapshot<P> = { status, pending, inflight, error, paused };

  function emit() {
    snapshot = { status, pending, inflight, error, paused };
    for (const listener of listeners) {
      listener();
    }
  }

  function hasBlocked(): boolean {
    return Object.entries(pending).some(([key, patch]) => options.canSave && !options.canSave(key, patch));
  }

  function recomputeStatus() {
    if (paused) {
      return;
    }
    if (Object.keys(inflight).length) {
      status = "saving";
    } else if (hasBlocked()) {
      status = "blocked";
    } else if (Object.keys(pending).length) {
      status = "pending";
    } else if (status !== "idle") {
      status = error ? "error" : "saved";
    }
  }

  function clearKeyTimer(key: string) {
    const handle = timers.get(key);
    if (handle !== undefined) {
      clearTimer(handle);
      timers.delete(key);
    }
  }

  async function saveKey(key: string): Promise<void> {
    clearKeyTimer(key);
    if (disposed || paused) {
      return;
    }
    const patch = pending[key];
    if (!patch) {
      return;
    }
    if (options.canSave && !options.canSave(key, patch)) {
      recomputeStatus();
      emit();
      return;
    }
    const { [key]: _taken, ...restPending } = pending;
    pending = restPending;
    inflight = { ...inflight, [key]: inflight[key] ? merge(inflight[key], patch) : patch };
    error = null;
    status = "saving";
    emit();
    try {
      await options.save(key, patch);
      const { [key]: _done, ...restInflight } = inflight;
      inflight = restInflight;
      status = "saved";
      recomputeStatus();
      emit();
    } catch (caught) {
      const { [key]: failed, ...restInflight } = inflight;
      inflight = restInflight;
      if (failed) {
        pending = { ...pending, [key]: pending[key] ? merge(failed, pending[key]) : failed };
      }
      error = caught;
      if (isConflict(caught)) {
        paused = true;
        status = "conflict";
      } else {
        status = "error";
      }
      emit();
    }
  }

  function flush(key?: string): Promise<void> {
    const keys = key ? [key] : Object.keys(pending);
    return Promise.all(keys.map((item) => saveKey(item))).then(() => undefined);
  }

  return {
    schedule(key, patch) {
      if (disposed) {
        return;
      }
      pending = { ...pending, [key]: pending[key] ? merge(pending[key], patch) : patch };
      if (!paused) {
        status = options.canSave && !options.canSave(key, pending[key]) ? "blocked" : "pending";
        clearKeyTimer(key);
        timers.set(
          key,
          setTimer(() => {
            timers.delete(key);
            void saveKey(key);
          }, options.delayMs)
        );
      }
      emit();
    },
    flush,
    discard(key) {
      if (key) {
        clearKeyTimer(key);
        const { [key]: _dropped, ...rest } = pending;
        pending = rest;
      } else {
        for (const item of Array.from(timers.keys())) {
          clearKeyTimer(item);
        }
        pending = {};
      }
      if (!Object.keys(pending).length) {
        paused = false;
        error = null;
        status = Object.keys(inflight).length ? "saving" : "idle";
      }
      recomputeStatus();
      emit();
    },
    resume() {
      paused = false;
      error = null;
      recomputeStatus();
      emit();
      return flush();
    },
    revalidate() {
      if (paused) {
        return;
      }
      recomputeStatus();
      emit();
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      for (const item of Array.from(timers.keys())) {
        clearKeyTimer(item);
      }
      listeners.clear();
    }
  };
}
