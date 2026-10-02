/** Shared by the server layout (boot script) and the client install hook. No "use client" on purpose. */

/** Fired on window whenever the deferred install prompt appears, is used, or the app gets installed. */
export const INSTALL_PROMPT_EVENT = "sentinel:installprompt";

/** Where the boot script parks the deferred `beforeinstallprompt` event (Chromium only). */
export const INSTALL_PROMPT_GLOBAL = "__sentinelInstallPrompt";

/** Set by the boot script on `appinstalled` (this tab just installed the app). */
export const APP_INSTALLED_GLOBAL = "__sentinelAppInstalled";

/**
 * Blocking inline script (rendered in <head> with the CSP nonce):
 *
 * - Captures `beforeinstallprompt` before React hydrates (Chromium may fire it early) so the
 *   "Install app" button can open the browser's install dialog later. It does NOT call
 *   preventDefault(): the browser keeps its own install promotion (address-bar icon, mini-infobar).
 * - Registers /sw.js after `load` (production only, secure contexts only).
 */
export function pwaBootScript(registerServiceWorker: boolean): string {
  const register = registerServiceWorker
    ? `if("serviceWorker" in navigator&&window.isSecureContext){w.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"}).catch(function(){});});}`
    : "";
  return `(function(){var w=window;function n(){w.dispatchEvent(new Event("${INSTALL_PROMPT_EVENT}"));}w.addEventListener("beforeinstallprompt",function(e){w.${INSTALL_PROMPT_GLOBAL}=e;n();});w.addEventListener("appinstalled",function(){w.${INSTALL_PROMPT_GLOBAL}=null;w.${APP_INSTALLED_GLOBAL}=true;n();});${register}})();`;
}
