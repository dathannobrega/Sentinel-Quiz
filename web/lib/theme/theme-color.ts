import { THEME_CANVAS_COLORS, THEME_COLOR_META_ID } from "@/lib/theme/boot";

/**
 * Browser chrome colour (`<meta name="theme-color">`): the app canvas of the resolved light/dark
 * theme, unless a full-screen surface with its own background (the Sentinel Arena screens) holds
 * an override. Overrides stack, so nested or overlapping surfaces restore correctly.
 */
const overrides: Array<{ color: string }> = [];

function themeColorMeta(): HTMLMetaElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const existing = document.getElementById(THEME_COLOR_META_ID);
  if (existing instanceof HTMLMetaElement) {
    return existing;
  }
  // The boot script normally creates it; recreate it if something removed it.
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.id = THEME_COLOR_META_ID;
  document.head.prepend(meta);
  return meta;
}

/** Re-applies the current colour (call after the light/dark theme changes). */
export function syncThemeColor() {
  const meta = themeColorMeta();
  if (!meta) {
    return;
  }
  const top = overrides[overrides.length - 1];
  meta.content = top ? top.color : THEME_CANVAS_COLORS[document.documentElement.dataset.theme === "dark" ? "dark" : "light"];
}

/** Paints the browser chrome with `color` until the returned release function is called. */
export function pushThemeColor(color: string): () => void {
  const entry = { color };
  overrides.push(entry);
  syncThemeColor();
  return () => {
    const index = overrides.indexOf(entry);
    if (index !== -1) {
      overrides.splice(index, 1);
      syncThemeColor();
    }
  };
}
