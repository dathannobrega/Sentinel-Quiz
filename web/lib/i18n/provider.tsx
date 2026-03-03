"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createTranslator, type AppLocale, type LocaleMessages, type TranslationValues } from "@/lib/i18n/core";

interface I18nContextValue {
  locale: AppLocale;
  messages: LocaleMessages;
  t: (key: string, values?: TranslationValues) => string;
  getMessage: <T = unknown>(key: string) => T;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  locale,
  messages
}: Readonly<{ children: ReactNode; locale: AppLocale; messages: LocaleMessages }>) {
  const value = useMemo(() => {
    const translator = createTranslator(messages);
    return {
      locale,
      messages,
      t: translator.t,
      getMessage: translator.getMessage
    };
  }, [locale, messages]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider.");
  }
  return context;
}
