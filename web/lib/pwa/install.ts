"use client";

import { useCallback, useSyncExternalStore } from "react";

import { APP_INSTALLED_GLOBAL, INSTALL_PROMPT_EVENT, INSTALL_PROMPT_GLOBAL } from "@/lib/pwa/boot";

/** Chromium's deferred install prompt (not in the TS DOM lib). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type PwaWindow = Window & {
  [INSTALL_PROMPT_GLOBAL]?: BeforeInstallPromptEvent | null;
  [APP_INSTALLED_GLOBAL]?: boolean;
};

/**
 * How this browser can install the app:
 * - `prompt`: Chromium (Edge, Chrome, Samsung Internet, Android) — our button opens its install dialog.
 * - `ios`: iPhone/iPad — "Add to Home Screen" from the Share sheet (no API; we show the steps).
 * - `safari-mac`: Safari 17+ on macOS — File > Add to Dock (no API; we show the steps).
 * - `installed`: running as the installed app, or just installed from this tab.
 * - `unavailable`: no install path we can offer (e.g. Firefox desktop, or Chromium already installed).
 */
export type InstallMode = "prompt" | "ios" | "safari-mac" | "installed" | "unavailable";

export function detectInstallPlatform(userAgent: string, maxTouchPoints: number): "ios" | "safari-mac" | "other" {
  // iPadOS reports a Mac user agent; touch support tells them apart.
  const iPadOs = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(userAgent) || iPadOs) {
    return "ios";
  }
  if (/Macintosh/.test(userAgent) && /Version\/\d+.*Safari\//.test(userAgent) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(userAgent)) {
    return "safari-mac";
  }
  return "other";
}

/** Running as an installed app (home-screen icon, app window, or desktop PWA with a custom title bar). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const media = typeof window.matchMedia === "function" ? window.matchMedia : null;
  const standalone = media ? ["standalone", "window-controls-overlay"].some((mode) => media(`(display-mode: ${mode})`).matches) : false;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function readMode(): InstallMode {
  const pwaWindow = window as PwaWindow;
  if (isStandaloneDisplay() || pwaWindow[APP_INSTALLED_GLOBAL]) {
    return "installed";
  }
  if (pwaWindow[INSTALL_PROMPT_GLOBAL]) {
    return "prompt";
  }
  const platform = detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints || 0);
  return platform === "other" ? "unavailable" : platform;
}

function subscribe(onChange: () => void) {
  const displayMode = typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)") : null;
  window.addEventListener(INSTALL_PROMPT_EVENT, onChange);
  displayMode?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(INSTALL_PROMPT_EVENT, onChange);
    displayMode?.removeEventListener("change", onChange);
  };
}

/** Install-app state and action. Renders as `unavailable` on the server (nothing to show). */
export function useInstallApp() {
  const mode = useSyncExternalStore<InstallMode>(subscribe, readMode, () => "unavailable");

  /** Opens the browser's install dialog (mode `prompt` only). Resolves with the user's choice. */
  const install = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    const pwaWindow = window as PwaWindow;
    const deferred = pwaWindow[INSTALL_PROMPT_GLOBAL];
    if (!deferred) {
      return "unavailable";
    }
    // A deferred prompt can be shown once; the browser fires a fresh event if it can ask again.
    pwaWindow[INSTALL_PROMPT_GLOBAL] = null;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      return outcome;
    } catch {
      return "unavailable";
    } finally {
      window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
    }
  }, []);

  return { mode, install };
}
