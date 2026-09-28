import { getActiveLocale } from "@/lib/i18n/active-locale";
import { getMessages, type AppLocale } from "@/lib/i18n/core";

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTime(value?: string | null, locale: AppLocale = getActiveLocale()): string {
  const parsed = parseDate(value);
  if (!parsed) {
    return "-";
  }
  return parsed.toLocaleString(locale, {
    dateStyle: "short",
    timeStyle: "short"
  });
}

export function formatDate(value?: string | null, locale: AppLocale = getActiveLocale()): string {
  const parsed = parseDate(value);
  if (!parsed) {
    return "-";
  }
  return parsed.toLocaleDateString(locale);
}

export function formatScore(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Number(value).toFixed(1)}%`;
}

/** "user" → synced account, anything else → this device only (localized). */
export function formatScope(scope: string, locale: AppLocale = getActiveLocale()): string {
  const labels = getMessages(locale).account.scope;
  return scope === "user" ? labels.user : labels.device;
}
