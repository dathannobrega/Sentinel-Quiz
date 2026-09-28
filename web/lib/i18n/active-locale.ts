import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "@/lib/i18n/core";

let activeLocale: AppLocale | null = null;

/**
 * Module-level locale for non-React helpers (API error messages, date formatting).
 * Kept in sync by I18nProvider; falls back to <html lang> in the browser.
 */
export function setActiveLocale(locale: AppLocale): void {
  activeLocale = locale;
}

export function getActiveLocale(): AppLocale {
  if (activeLocale) {
    return activeLocale;
  }
  if (typeof document !== "undefined") {
    const lang = document.documentElement.lang;
    if (isSupportedLocale(lang)) {
      return lang;
    }
  }
  return DEFAULT_LOCALE;
}
