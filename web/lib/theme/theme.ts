"use client";

import { useCallback, useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "@/lib/theme/boot";
import { syncThemeColor } from "@/lib/theme/theme-color";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_EVENT = "sentinel:theme";

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return preference;
}

function apply(preference: ThemePreference) {
  document.documentElement.dataset.theme = resolve(preference);
  syncThemeColor();
}

function subscribe(onChange: () => void) {
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const handleMedia = () => {
    if (readPreference() === "system") {
      apply("system");
    }
    onChange();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      apply(readPreference());
      onChange();
    }
  };
  media?.addEventListener("change", handleMedia);
  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    media?.removeEventListener("change", handleMedia);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}

/** Theme preference (light / dark / follow the OS), persisted per device. */
export function useTheme() {
  const preference = useSyncExternalStore<ThemePreference>(subscribe, readPreference, () => "system");

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // Best effort (private mode): still apply for this page view.
    }
    apply(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return { preference, setPreference };
}
