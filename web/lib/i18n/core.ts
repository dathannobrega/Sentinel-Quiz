import { enUSMessages } from "@/lib/i18n/locales/en-us";
import { ptBRMessages } from "@/lib/i18n/locales/pt-br";

export const SUPPORTED_LOCALES = ["pt-BR", "en-US"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocaleMessages = typeof ptBRMessages;
export type TranslationValues = Record<string, string | number>;

const catalogs: Record<AppLocale, LocaleMessages> = {
  "pt-BR": ptBRMessages,
  "en-US": enUSMessages
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getMessages(locale: AppLocale): LocaleMessages {
  return catalogs[locale] || catalogs["pt-BR"];
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
