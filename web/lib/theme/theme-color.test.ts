// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { THEME_CANVAS_COLORS, THEME_COLOR_META_ID, themeBootScript } from "@/lib/theme/boot";
import { pushThemeColor, syncThemeColor } from "@/lib/theme/theme-color";

function metas() {
  return Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
}

afterEach(() => {
  document.head.innerHTML = "";
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe("theme-color", () => {
  it("the boot script creates a single meta, first in <head>, with the resolved canvas colour", () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width">';
    localStorage.setItem("sentinel.theme", "dark");
    new Function(themeBootScript)();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(metas()).toHaveLength(1);
    expect(document.head.firstElementChild?.id).toBe(THEME_COLOR_META_ID);
    expect(metas()[0].content).toBe(THEME_CANVAS_COLORS.dark);
  });

  it("follows the light/dark theme and lets full-screen surfaces override it, in stack order", () => {
    document.documentElement.dataset.theme = "light";
    syncThemeColor();
    expect(metas()[0].content).toBe(THEME_CANVAS_COLORS.light);

    const releaseStage = pushThemeColor("#070a1a");
    const releaseToast = pushThemeColor("#000000");
    expect(metas()[0].content).toBe("#000000");

    releaseStage();
    expect(metas()[0].content).toBe("#000000");
    releaseToast();
    expect(metas()[0].content).toBe(THEME_CANVAS_COLORS.light);

    document.documentElement.dataset.theme = "dark";
    syncThemeColor();
    expect(metas()).toHaveLength(1);
    expect(metas()[0].content).toBe(THEME_CANVAS_COLORS.dark);
  });
});
