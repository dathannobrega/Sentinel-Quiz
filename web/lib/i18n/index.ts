export {
  createTranslator,
  DEFAULT_LOCALE,
  formatMessage,
  getMessageValue,
  getMessages,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
  matchLocale,
  SUPPORTED_LOCALES
} from "@/lib/i18n/core";
export type { AppLocale, LocaleMessages, TranslationValues } from "@/lib/i18n/core";
export { I18nProvider, useI18n, useOptionalI18n } from "@/lib/i18n/provider";
