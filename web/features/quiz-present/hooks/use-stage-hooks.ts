"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// ----------------------------------------------------------------------------- fullscreen

function subscribeFullscreen(callback: () => void) {
  document.addEventListener("fullscreenchange", callback);
  return () => document.removeEventListener("fullscreenchange", callback);
}

export function useFullscreen() {
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => Boolean(document.fullscreenElement),
    () => false
  );
  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
    } catch {
      // Denied (iframe, iOS Safari): the stage still works windowed.
    }
  }, []);
  const supported = typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function";
  return { isFullscreen, toggle, supported };
}

// ----------------------------------------------------------------------------- wake lock

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

/** Keeps the projector laptop awake while the stage is open (re-acquired when the tab returns). */
export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") {
      return undefined;
    }
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wakeLock) {
      return undefined;
    }
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (sentinelRef.current && !sentinelRef.current.released)) {
        return;
      }
      try {
        const sentinel = await wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Battery saver or permissions policy: ignore.
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinelRef.current?.release().catch(() => undefined);
      sentinelRef.current = null;
    };
  }, [enabled]);
}

// ----------------------------------------------------------------------------- hotkeys

export type HotkeyCommand = "advance" | "lock" | "reveal" | "leaderboard" | "fullscreen" | "calm" | "help" | "controls" | "escape";

/** Maps a key event to a presenter command (exported for tests). Clickers send PageDown/PageUp. */
export function hotkeyFor(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">): HotkeyCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  switch (event.key) {
    case " ":
    case "ArrowRight":
    case "PageDown":
    case "Enter":
      return "advance";
    case "l":
    case "L":
      return "lock";
    case "r":
    case "R":
      return "reveal";
    case "b":
    case "B":
      return "leaderboard";
    case "f":
    case "F":
      return "fullscreen";
    case "z":
    case "Z":
      return "calm";
    case "h":
    case "H":
      return "controls";
    case "?":
      return "help";
    case "Escape":
      return "escape";
    default:
      return event.code === "Slash" && event.key === "?" ? "help" : null;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit"].includes(type);
  }
  return false;
}

export function usePresenterHotkeys(onCommand: (command: HotkeyCommand) => void, enabled = true) {
  const handlerRef = useRef(onCommand);
  useEffect(() => {
    handlerRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target)) {
        return;
      }
      // Buttons handle their own Space/Enter; don't double-fire the advance action.
      if ((event.key === " " || event.key === "Enter") && event.target instanceof HTMLElement && event.target.closest("button, a, summary, [role='button']")) {
        return;
      }
      if (document.querySelector("dialog[open]") && event.key !== "Escape") {
        return;
      }
      const command = hotkeyFor(event);
      if (!command) {
        return;
      }
      if (command !== "escape") {
        event.preventDefault();
      }
      handlerRef.current(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}


/** Live height (px) of an element, tracked with ResizeObserver (0 until measured). */
export function useElementHeight<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      setHeight(Math.ceil(box ? box.blockSize : node.getBoundingClientRect().height));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, height];
}
