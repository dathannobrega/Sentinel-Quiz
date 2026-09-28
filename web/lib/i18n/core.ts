import { enUSMessages } from "@/lib/i18n/locales/en-us";
import { ptBRMessages } from "@/lib/i18n/locales/pt-br";

export const SUPPORTED_LOCALES = ["pt-BR", "en-US"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "pt-BR";
export const LOCALE_COOKIE_NAME = "sentinel_locale";
export const LOCALE_STORAGE_KEY = "sentinel_locale";

type WidenMessageLiterals<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: WidenMessageLiterals<T[K]> }
    : T extends object
      ? { readonly [K in keyof T]: WidenMessageLiterals<T[K]> }
      : T;

export type LocaleMessages = WidenMessageLiterals<typeof ptBRMessages>;
export type TranslationValues = Record<string, string | number>;

const catalogs: Record<AppLocale, LocaleMessages> = {
  "pt-BR": ptBRMessages,
  "en-US": enUSMessages
};

export function isSupportedLocale(value: string): value is AppLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Maps an Accept-Language header (or any free-form locale string) to a supported locale. */
export function matchLocale(value: string | null | undefined): AppLocale | null {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  if (isSupportedLocale(raw)) {
    return raw;
  }
  const candidates = raw
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.startsWith("pt")) {
      return "pt-BR";
    }
    if (candidate.startsWith("en")) {
      return "en-US";
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getMessages(locale: AppLocale): LocaleMessages {
  return catalogs[locale] || catalogs[DEFAULT_LOCALE];
}

export function getMessageValue(messages: LocaleMessages, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (!isRecord(value)) {
      return undefined;
    }
    return value[part];
  }, messages);
}

export function formatMessage(template: string, values?: TranslationValues): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, token) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}

export function createTranslator(messages: LocaleMessages) {
  function t(key: string, values?: TranslationValues): string {
    const value = getMessageValue(messages, key);
    if (typeof value !== "string") {
      return key;
    }
    return formatMessage(value, values);
  }

  function getMessage<T = unknown>(key: string): T {
    return getMessageValue(messages, key) as T;
  }

  return { t, getMessage };
}
