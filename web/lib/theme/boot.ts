/** Shared by the server layout (boot script) and the client hook. No "use client" on purpose. */
export const THEME_STORAGE_KEY = "sentinel.theme";

/** `--sq-canvas` per resolved theme (styles/theme.css): browser UI / status bar / app title bar. */
export const THEME_CANVAS_COLORS = { light: "#f4f5f7", dark: "#0f1115" } as const;

/** The single `<meta name="theme-color">`, created by the boot script and updated by lib/theme. */
export const THEME_COLOR_META_ID = "sq-theme-color";

/**
 * Blocking inline script (rendered in <head> with the CSP nonce): resolves the stored preference
 * before first paint so there is no light→dark flash, and paints the browser chrome (Android status
 * bar, installed-app title bar) with the same canvas colour. The meta goes first in <head> because
 * the first matching theme-color wins.
 */
export const themeBootScript = `(function(){var d=false;try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);}catch(e){}document.documentElement.dataset.theme=d?"dark":"light";try{var m=document.createElement("meta");m.name="theme-color";m.id="${THEME_COLOR_META_ID}";m.content=d?"${THEME_CANVAS_COLORS.dark}":"${THEME_CANVAS_COLORS.light}";document.head.prepend(m);}catch(e){}})();`;
