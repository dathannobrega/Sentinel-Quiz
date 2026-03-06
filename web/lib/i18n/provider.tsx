"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  createTranslator,
  getMessages,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type AppLocale,
  type LocaleMessages,
  type TranslationValues
} from "@/lib/i18n/core";

const LOCALE_STORAGE_KEY = "sentinel_locale";

function readStoredLocale(): AppLocale | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = String(window.localStorage.getItem(LOCALE_STORAGE_KEY) || "").trim();
    return isSupportedLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function persistLocale(locale: AppLocale): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Best effort only.
  }
}

interface I18nContextValue {
  locale: AppLocale;
  availableLocales: readonly AppLocale[];
  messages: LocaleMessages;
  t: (key: string, values?: TranslationValues) => string;
  getMessage: <T = unknown>(key: string) => T;
  setLocale: (locale: AppLocale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  locale,
  messages: initialMessages
}: Readonly<{ children: ReactNode; locale: AppLocale; messages?: LocaleMessages }>) {
  const [activeLocale, setActiveLocale] = useState<AppLocale>(locale);
  const [messages, setMessages] = useState<LocaleMessages>(initialMessages ?? getMessages(locale));

  useEffect(() => {
    const storedLocale = readStoredLocale();
    if (!storedLocale || storedLocale === activeLocale) {
      return;
    }
    setActiveLocale(storedLocale);
    setMessages(getMessages(storedLocale));
  }, [activeLocale]);

  useEffect(() => {
    document.documentElement.lang = activeLocale;
  }, [activeLocale]);

  const value = useMemo(() => {
    const translator = createTranslator(messages);
    return {
      locale: activeLocale,
      availableLocales: SUPPORTED_LOCALES,
      messages,
      t: translator.t,
      getMessage: translator.getMessage,
      setLocale(nextLocale: AppLocale) {
        if (nextLocale === activeLocale) {
          return;
        }
        persistLocale(nextLocale);
        startTransition(() => {
          setActiveLocale(nextLocale);
          setMessages(getMessages(nextLocale));
        });
      }
    };
  }, [activeLocale, messages]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider.");
  }
  return context;
}
