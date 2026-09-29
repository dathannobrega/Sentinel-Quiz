"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query. `fallback` is used on the server and where matchMedia is missing
 * (jsdom), so tests render the "wide" layout with every region in the DOM.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") {
        return () => undefined;
      }
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback),
    () => fallback
  );
}
