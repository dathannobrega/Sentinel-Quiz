/** Shared by the server layout (boot script) and the client hook. No "use client" on purpose. */
export const THEME_STORAGE_KEY = "sentinel.theme";

/**
 * Blocking inline script (rendered in <head> with the CSP nonce): resolves the stored preference
 * before first paint so there is no light→dark flash.
 */
export const themeBootScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;
