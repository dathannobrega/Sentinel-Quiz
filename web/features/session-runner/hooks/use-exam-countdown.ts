"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { parseServerTimestamp } from "@/features/session-runner/lib/runner-utils";

const CLOCK_SKEW_TOLERANCE_MS = 5_000;

export interface CountdownInput {
  /** Naive-UTC ISO deadline from the backend (null while paused). */
  expiresAt: string | null;
  /** Remaining seconds as computed by the backend when the session was fetched. */
  remainingSeconds: number | null;
  paused: boolean;
}

interface DeadlineInput extends CountdownInput {
  /** Wall-clock ms when this snapshot of the timing fields was received. */
  fetchedAt: number;
}

/**
 * Resolves an absolute deadline once per session snapshot. `expires_at` is authoritative, but if
 * the client clock disagrees with the server by more than a few seconds we anchor on
 * `fetchedAt + remaining_seconds` instead (same deadline, skew-corrected). Remaining time is
 * always recomputed from Date.now(), so throttled/background timers never drift.
 */
export function resolveDeadline({ expiresAt, remainingSeconds, fetchedAt, paused }: DeadlineInput): number | null {
  if (paused) {
    return null;
  }
  const fromRemaining = typeof remainingSeconds === "number" ? fetchedAt + remainingSeconds * 1000 : null;
  const fromExpiresAt = parseServerTimestamp(expiresAt);
  if (fromExpiresAt !== null && fromRemaining !== null) {
    return Math.abs(fromExpiresAt - fromRemaining) > CLOCK_SKEW_TOLERANCE_MS ? fromRemaining : fromExpiresAt;
  }
  return fromExpiresAt ?? fromRemaining;
}

function secondsUntil(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/** Returns the live remaining seconds; ticks only inside the component that uses it. */
export function useExamCountdown(input: CountdownInput, onExpire: () => void): number | null {
  const { expiresAt, remainingSeconds, paused } = input;
  // Anchor the snapshot when the timing fields change (not on unrelated cache patches, which
  // would otherwise shift the deadline).
  const deadline = useMemo(
    () => resolveDeadline({ expiresAt, remainingSeconds, paused, fetchedAt: Date.now() }),
    [expiresAt, remainingSeconds, paused]
  );
  const [now, setNow] = useState(() => Date.now());
  const onExpireRef = useRef(onExpire);
  const expiredForDeadline = useRef<number | null>(null);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (deadline === null) {
      return;
    }
    const tick = () => {
      setNow(Date.now());
      if (secondsUntil(deadline) <= 0 && expiredForDeadline.current !== deadline) {
        expiredForDeadline.current = deadline;
        onExpireRef.current();
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [deadline]);

  if (deadline === null) {
    return typeof remainingSeconds === "number" ? Math.max(0, remainingSeconds) : null;
  }
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
