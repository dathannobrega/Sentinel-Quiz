"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import type { LiveConnectionState } from "@/features/quiz-live/lib/live-store";
import type { LiveTransport } from "@/features/quiz-live/lib/protocol";
import type { LiveThemeKey } from "@/types/api/live";
import { cn } from "@/lib/utils/cn";

const THEME_KEYS: ReadonlySet<string> = new Set(["sentinel", "terminal", "neon_soc", "aurora", "high_contrast"]);

export function safeThemeKey(value: string | null | undefined): LiveThemeKey {
  return value && THEME_KEYS.has(value) ? (value as LiveThemeKey) : "sentinel";
}

/** Animated theme background (pseudo-elements only; off under reduced motion / calm mode). */
export function LiveBackdrop({ particles = false }: { particles?: boolean }) {
  return (
    <div aria-hidden="true" className="lq-backdrop">
      <span />
      <span />
      <span />
      {particles ? (
        <div className="lq-particles absolute inset-0">
          {Array.from({ length: 12 }, (_, index) => (
            <i
              key={index}
              style={{
                left: `${(index * 83) % 100}%`,
                animationDelay: `${-(index * 1.3)}s`,
                animationDuration: `${12 + ((index * 7) % 9)}s`,
                width: `${4 + (index % 3) * 2}px`,
                height: `${4 + (index % 3) * 2}px`
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Theme container for every live surface. */
export function LiveThemeRoot({
  theme,
  calm = false,
  className,
  children,
  backdrop = true,
  particles = false
}: {
  theme: string | null | undefined;
  calm?: boolean;
  className?: string;
  children: ReactNode;
  backdrop?: boolean;
  particles?: boolean;
}) {
  return (
    <div data-lq-theme={safeThemeKey(theme)} data-lq-calm={calm ? "true" : undefined} className={cn("relative isolate overflow-hidden", className)}>
      {backdrop ? <LiveBackdrop particles={particles} /> : null}
      {/* h-full gives descendants a DEFINITE height: the stage is a size container, and with
          only min-height its cqh/cqmin units resolve to 0 (tiny text, collapsed QR). */}
      <div className="relative z-[1] flex h-full min-h-full flex-col">{children}</div>
    </div>
  );
}

/**
 * Polite live region for phase changes. Announces without moving focus; the message is cleared
 * and re-set so repeated phases are read again.
 */
export function LiveAnnouncer({ message }: { message: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const clear = setTimeout(() => setText(""), 0);
    const timer = setTimeout(() => setText(message), 60);
    return () => {
      clearTimeout(clear);
      clearTimeout(timer);
    };
  }, [message]);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true
  );
}

export interface ConnectionBannerLabels {
  connecting: string;
  reconnecting: string;
  offline: string;
}

/**
 * Offline / reconnecting banner. Hidden while connected; appears after a short grace period so a
 * fast reconnect does not flash.
 */
export function ConnectionBanner({ connection, labels, className }: { connection: LiveConnectionState; labels: ConnectionBannerLabels; className?: string }) {
  const online = useOnline();
  const unstable = connection.status === "reconnecting" || connection.status === "connecting";
  const [armed, setArmed] = useState(false);
  const troubled = unstable || !online;

  useEffect(() => {
    // Grace period so a fast reconnect never flashes the banner; reset once things are fine.
    const timer = setTimeout(() => setArmed(troubled), troubled && online ? 900 : 0);
    return () => clearTimeout(timer);
  }, [troubled, online]);

  if (!troubled || !armed) {
    return null;
  }
  const text = !online ? labels.offline : connection.status === "connecting" && connection.attempt === 0 ? labels.connecting : labels.reconnecting;
  return (
    <div role="status" className={cn("flex items-center justify-center gap-2 bg-lq-warning px-4 py-2 text-center text-sm font-semibold text-lq-on-warning", className)}>
      <span aria-hidden="true" className="inline-block size-2 animate-pulse rounded-full bg-current" />
      {text}
    </div>
  );
}

/** Pause glyph: two rounded bars (paired with a text label, never colour alone). */
export function PauseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <rect x="5.5" y="4" width="4.5" height="16" rx="1.4" fill="currentColor" />
      <rect x="14" y="4" width="4.5" height="16" rx="1.4" fill="currentColor" />
    </svg>
  );
}

/**
 * Unobtrusive "fallback connection" pill (RNF-309): shown only while the client runs on SSE + POST.
 * The hint is exposed as the accessible description and as a native tooltip.
 */
export function TransportBadge({ transport, label, hint, className }: { transport: LiveTransport; label: string; hint: string; className?: string }) {
  if (transport !== "sse") {
    return null;
  }
  return (
    <span
      title={hint}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-lq-line bg-lq-surface px-2.5 py-0.5 text-[0.7rem] font-semibold text-lq-fg-muted motion-safe:animate-[rise-in_260ms_ease-out_both]",
        className
      )}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round">
        <path d="M2 6.5a9 9 0 0 1 12 0M4.5 9a5.5 5.5 0 0 1 7 0" />
        <circle cx="8" cy="12" r="1.2" className="fill-current stroke-none" />
      </svg>
      {label}
      <span className="sr-only">: {hint}</span>
    </span>
  );
}

/** Safe haptics (Android/Chrome); no-op elsewhere and under reduced motion. */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    navigator.vibrate(pattern);
  } catch {
    // Ignore: haptics are a bonus.
  }
}
