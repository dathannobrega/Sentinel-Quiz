import type { TranslationValues } from "@/lib/i18n/core";

type Translate = (key: string, values?: TranslationValues) => string;
type RawParams = Record<string, string | number | null | undefined> | null | undefined;

const UNRESOLVED_PLACEHOLDER = /\{\w+\}/;

function cleanParams(params: RawParams): TranslationValues {
  const values: TranslationValues = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === "string" || typeof value === "number") {
      values[key] = value;
    }
  }
  return values;
}

/**
 * Translates a backend message code (M-C7): looks up `backend.<code>[.<field>]` in the active
 * catalog and interpolates `params`. Falls back to the backend-provided text when the code is
 * unknown (or a placeholder could not be filled), so new backend codes never render as keys.
 */
export function translateBackendMessage(
  t: Translate,
  code: string | null | undefined,
  params: RawParams,
  fallback: string,
  field?: string
): string {
  if (!code) {
    return fallback;
  }
  const key = field ? `backend.${code}.${field}` : `backend.${code}`;
  const text = t(key, cleanParams(params));
  if (!text || text === key || UNRESOLVED_PLACEHOLDER.test(text)) {
    return fallback;
  }
  return text;
}

/** Localized readiness band label; unknown bands are shown as sent by the backend. */
export function translateReadinessBand(t: Translate, band: string | null | undefined): string {
  const value = String(band || "").trim();
  if (!value) {
    return "-";
  }
  const key = `backend.readinessBands.${value}`;
  const text = t(key);
  return text === key ? value : text;
}
