"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { setApiErrorLocale } from "@/lib/api/errors";
import {
  createTranslator,
  getMessages,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  type AppLocale,
  type LocaleMessages,
  type TranslationValues
} from "@/lib/i18n/core";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

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

  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`;
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
  localeFromCookie = false
}: Readonly<{
  children: ReactNode;
  locale: AppLocale;
  /** True when the server resolved the locale from the `sentinel_locale` cookie. */
  localeFromCookie?: boolean;
}>) {
  const router = useRouter();
  const [activeLocale, setActiveLocale] = useState<AppLocale>(locale);
  const messages = useMemo(() => getMessages(activeLocale), [activeLocale]);

  // Keep module-level consumers (apiClient error messages) in sync during render.
  setApiErrorLocale(activeLocale);

  useEffect(() => {
    setActiveLocale(locale);
  }, [locale]);

  useEffect(() => {
    // Legacy fallback: locale used to live only in localStorage. Migrate it into the cookie
    // so the server renders the right language on the next request.
    if (localeFromCookie) {
      return;
    }
    const storedLocale = readStoredLocale();
    if (!storedLocale) {
      return;
    }
    persistLocale(storedLocale);
    if (storedLocale !== locale) {
      startTransition(() => {
        setActiveLocale(storedLocale);
        router.refresh();
      });
    }
  }, [locale, localeFromCookie, router]);

  useEffect(() => {
    document.documentElement.lang = activeLocale;
  }, [activeLocale]);

  const value = useMemo<I18nContextValue>(() => {
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
          router.refresh();
        });
      }
    };
  }, [activeLocale, messages, router]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Like useI18n but returns null outside the provider (e.g. inside app/global-error.tsx). */
export function useOptionalI18n() {
  return useContext(I18nContext);
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider.");
  }
  return context;
}
