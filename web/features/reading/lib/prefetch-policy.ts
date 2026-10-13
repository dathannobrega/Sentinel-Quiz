/**
 * Anticipation rules of the reader (Increment 3 §4.2), framework-free:
 * - while a block plays, the next block of the section is streamed in the background (one ahead);
 *   on the last block, the next section and its first block are fetched instead;
 * - opening a section or changing voice/speed warms the server (`POST …/warm`) with the current
 *   block, debounced 2 s and at most once per minute per section.
 */

export type PrefetchPlan = { kind: "block"; index: number } | { kind: "next-section"; sectionId: string } | null;

/** What to prefetch while `activeIndex` plays. */
export function planPrefetch(input: { activeIndex: number; blockCount: number; nextSectionId: string | null }): PrefetchPlan {
  const next = input.activeIndex + 1;
  if (next < input.blockCount) {
    return { kind: "block", index: next };
  }
  return input.nextSectionId ? { kind: "next-section", sectionId: input.nextSectionId } : null;
}

export const WARM_DEBOUNCE_MS = 2_000;
export const WARM_MIN_INTERVAL_MS = 60_000;

export interface WarmScheduler<T> {
  /** Schedules a warm request for a section (the latest payload wins). */
  request(sectionId: string, payload: T): void;
  cancel(): void;
}

export function createWarmScheduler<T>(
  send: (sectionId: string, payload: T) => void,
  options: {
    debounceMs?: number;
    minIntervalMs?: number;
    now?: () => number;
  } = {}
): WarmScheduler<T> {
  const debounceMs = options.debounceMs ?? WARM_DEBOUNCE_MS;
  const minIntervalMs = options.minIntervalMs ?? WARM_MIN_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const lastSent = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
      timer = null;
    }
  };

  return {
    request(sectionId, payload) {
      cancel();
      timer = globalThis.setTimeout(() => {
        timer = null;
        const previous = lastSent.get(sectionId);
        const at = now();
        if (previous !== undefined && at - previous < minIntervalMs) {
          return;
        }
        lastSent.set(sectionId, at);
        send(sectionId, payload);
      }, debounceMs);
    },
    cancel
  };
}
