"use client";

import { useCallback, useSyncExternalStore } from "react";

const FOCUS_MODE_KEY = "sentinel.runner.focus_mode";
const FOCUS_EVENT = "sentinel:focus-mode";

function read(): boolean {
  try {
    return window.localStorage.getItem(FOCUS_MODE_KEY) === "on";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(FOCUS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(FOCUS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Focus mode: the runner drops secondary chrome (panel, metadata, exit link) and keeps only the
 * question, progress, time and essential navigation. Independent from the color theme; per device.
 */
export function useFocusMode() {
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  const setEnabled = useCallback((next: boolean) => {
    try {
      if (next) {
        window.localStorage.setItem(FOCUS_MODE_KEY, "on");
      } else {
        window.localStorage.removeItem(FOCUS_MODE_KEY);
      }
    } catch {
      // Best effort.
    }
    window.dispatchEvent(new Event(FOCUS_EVENT));
  }, []);
  const toggle = useCallback(() => setEnabled(!read()), [setEnabled]);
  return { enabled, setEnabled, toggle };
}
