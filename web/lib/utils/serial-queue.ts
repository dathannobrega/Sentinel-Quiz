/**
 * Runs async tasks strictly one after another (FIFO). The editor pushes every quiz mutation
 * through one queue so each request reads the `version` produced by the previous one: no two
 * requests ever race with the same `expected_version`.
 *
 * A failed task rejects its own promise only; the queue keeps going with the next task.
 */
export interface SerialQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  /** Tasks queued or running. */
  readonly size: number;
  /** Resolves once everything queued so far has settled. */
  idle(): Promise<void>;
  subscribe(listener: (size: number) => void): () => void;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let size = 0;
  const listeners = new Set<(size: number) => void>();

  const emit = () => {
    for (const listener of listeners) {
      listener(size);
    }
  };

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      size += 1;
      emit();
      const run = tail.then(
        () => task(),
        () => task()
      );
      const settled = run.finally(() => {
        size -= 1;
        emit();
      });
      // The chain must never reject, otherwise the next task would see the previous failure.
      tail = settled.catch(() => undefined);
      return settled;
    },
    get size() {
      return size;
    },
    idle() {
      return tail.then(() => undefined);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
