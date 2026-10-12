/**
 * Sleep timer: stops playback after N minutes (with a 10 s fade-out) or at the end of the section.
 * The timing logic is framework-free (tested with fake timers); `useSleepTimer` wraps it for React.
 */

export type SleepTimerOption = "off" | "10" | "20" | "30" | "45" | "60" | "section";

export const SLEEP_TIMER_OPTIONS: readonly SleepTimerOption[] = ["off", "10", "20", "30", "45", "60", "section"];

export const SLEEP_FADE_MS = 10_000;
export const SLEEP_TICK_MS = 250;

/** Minutes of a timed option; null for "off" and "section". */
export function sleepOptionMinutes(option: SleepTimerOption): number | null {
  if (option === "off" || option === "section") {
    return null;
  }
  return Number(option);
}

/** Playback volume for the remaining time: 1 until the last `fadeMs`, then linear down to 0. */
export function fadeVolume(remainingMs: number, fadeMs = SLEEP_FADE_MS): number {
  if (remainingMs >= fadeMs) {
    return 1;
  }
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.round((remainingMs / fadeMs) * 1000) / 1000;
}

export interface SleepTimerCallbacks {
  /** Every tick: remaining milliseconds and the volume to apply. */
  onTick?: (remainingMs: number, volume: number) => void;
  /** Once, when the time is up (after the fade). */
  onExpire: () => void;
}

export interface SleepTimerHandle {
  cancel(): void;
  remainingMs(): number;
}

/** Starts a countdown of `durationMs`; ticks every 250 ms until it expires or is cancelled. */
export function startSleepTimer(
  durationMs: number,
  callbacks: SleepTimerCallbacks,
  options: { tickMs?: number; fadeMs?: number; now?: () => number } = {}
): SleepTimerHandle {
  const now = options.now ?? (() => Date.now());
  const fadeMs = options.fadeMs ?? SLEEP_FADE_MS;
  const endsAt = now() + Math.max(0, durationMs);
  let finished = false;
  const remaining = () => Math.max(0, endsAt - now());

  const timer = globalThis.setInterval(() => {
    if (finished) {
      return;
    }
    const left = remaining();
    callbacks.onTick?.(left, fadeVolume(left, fadeMs));
    if (left <= 0) {
      finished = true;
      globalThis.clearInterval(timer);
      callbacks.onExpire();
    }
  }, options.tickMs ?? SLEEP_TICK_MS);

  return {
    cancel() {
      finished = true;
      globalThis.clearInterval(timer);
    },
    remainingMs: remaining
  };
}

/** "12:05" style countdown (minutes may exceed 59). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
