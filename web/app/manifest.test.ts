import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/lib/i18n";

const requestLocale = vi.hoisted(() => ({ current: "pt-BR" as AppLocale }));
vi.mock("@/lib/i18n/server", () => ({
  getRequestLocale: async () => ({ locale: requestLocale.current, fromCookie: false })
}));

const { default: manifest } = await import("./manifest");

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

describe("web app manifest", () => {
  it("meets the install criteria (name, standalone, start_url, 192 and 512 icons incl. maskable)", async () => {
    const result = await manifest();
    expect(result.name).toBe("Sentinel Quiz");
    expect(result.short_name?.length).toBeLessThanOrEqual(12);
    expect(result.display).toBe("standalone");
    expect(result.start_url).toBe("/dashboard");
    expect(result.scope).toBe("/");

    const sizes = (purpose: string) => (result.icons ?? []).filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes);
    expect(sizes("any")).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(sizes("maskable")).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("points only at files that exist in public/", async () => {
    const result = await manifest();
    const sources = [...(result.icons ?? []), ...(result.shortcuts ?? []).flatMap((shortcut) => shortcut.icons ?? [])].map((icon) => icon.src);
    for (const src of new Set(sources)) {
      expect(existsSync(path.join(PUBLIC_DIR, src)), src).toBe(true);
    }
  });

  it("is localized from the request (Accept-Language)", async () => {
    requestLocale.current = "en-US";
    const english = await manifest();
    requestLocale.current = "pt-BR";
    const portuguese = await manifest();

    expect(english.lang).toBe("en-US");
    expect(english.shortcuts?.[0]?.name).toBe("New session");
    expect(portuguese.lang).toBe("pt-BR");
    expect(portuguese.shortcuts?.[0]?.name).toBe("Nova sessão");
  });
});
