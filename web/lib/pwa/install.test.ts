// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { APP_INSTALLED_GLOBAL, INSTALL_PROMPT_EVENT, INSTALL_PROMPT_GLOBAL, pwaBootScript } from "@/lib/pwa/boot";
import { detectInstallPlatform, useInstallApp } from "@/lib/pwa/install";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
};

type PwaGlobals = Record<string, unknown>;

function setUserAgent(userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  // jsdom has no maxTouchPoints.
  Object.defineProperty(navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
}

function fakePromptEvent(outcome: "accepted" | "dismissed") {
  return Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome, platform: "web" })
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "maxTouchPoints");
  delete (window as unknown as PwaGlobals)[INSTALL_PROMPT_GLOBAL];
  delete (window as unknown as PwaGlobals)[APP_INSTALLED_GLOBAL];
});

describe("detectInstallPlatform", () => {
  it("recognizes iPhone and iPad (any iOS browser) as Add to Home Screen", () => {
    expect(detectInstallPlatform(UA.iphoneSafari, 5)).toBe("ios");
    expect(detectInstallPlatform(UA.iphoneChrome, 5)).toBe("ios");
    // iPadOS sends a desktop Mac user agent; touch points give it away.
    expect(detectInstallPlatform(UA.macSafari, 5)).toBe("ios");
  });

  it("recognizes Safari on macOS (Add to Dock), not other Mac browsers", () => {
    expect(detectInstallPlatform(UA.macSafari, 0)).toBe("safari-mac");
    expect(detectInstallPlatform(UA.macChrome, 0)).toBe("other");
  });

  it("leaves Chromium browsers to the beforeinstallprompt flow", () => {
    expect(detectInstallPlatform(UA.windowsEdge, 0)).toBe("other");
    expect(detectInstallPlatform(UA.androidChrome, 5)).toBe("other");
  });
});

describe("useInstallApp", () => {
  it("offers the browser prompt when the boot script captured one, and clears it after use", async () => {
    setUserAgent(UA.windowsEdge);
    const deferred = fakePromptEvent("accepted");
    (window as unknown as PwaGlobals)[INSTALL_PROMPT_GLOBAL] = deferred;

    const { result } = renderHook(() => useInstallApp());
    expect(result.current.mode).toBe("prompt");

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.install();
    });
    expect(deferred.prompt).toHaveBeenCalledTimes(1);
    expect(outcome).toBe("accepted");
    expect(result.current.mode).toBe("unavailable");
  });

  it("follows the prompt event and the appinstalled flag", () => {
    setUserAgent(UA.androidChrome, 5);
    const { result } = renderHook(() => useInstallApp());
    expect(result.current.mode).toBe("unavailable");

    act(() => {
      (window as unknown as PwaGlobals)[INSTALL_PROMPT_GLOBAL] = fakePromptEvent("dismissed");
      window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
    });
    expect(result.current.mode).toBe("prompt");

    act(() => {
      (window as unknown as PwaGlobals)[INSTALL_PROMPT_GLOBAL] = null;
      (window as unknown as PwaGlobals)[APP_INSTALLED_GLOBAL] = true;
      window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
    });
    expect(result.current.mode).toBe("installed");
  });

  it("shows manual steps on iOS and reports installed when launched from the home screen", () => {
    setUserAgent(UA.iphoneSafari, 5);
    const { result, unmount } = renderHook(() => useInstallApp());
    expect(result.current.mode).toBe("ios");
    unmount();

    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    try {
      const standalone = renderHook(() => useInstallApp());
      expect(standalone.result.current.mode).toBe("installed");
    } finally {
      Reflect.deleteProperty(navigator, "standalone");
    }
  });
});

describe("pwaBootScript", () => {
  it("registers the service worker only when asked (production)", () => {
    expect(pwaBootScript(true)).toContain('navigator.serviceWorker.register("/sw.js"');
    expect(pwaBootScript(false)).not.toContain("serviceWorker");
  });

  it("never suppresses the browser's own install promotion", () => {
    expect(pwaBootScript(true)).not.toContain("preventDefault");
  });
});
