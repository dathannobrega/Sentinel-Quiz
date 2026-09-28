import { cookies, headers } from "next/headers";

import {
  createTranslator,
  DEFAULT_LOCALE,
  getMessages,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
  matchLocale,
  type AppLocale
} from "@/lib/i18n/core";

export interface RequestLocale {
  locale: AppLocale;
  fromCookie: boolean;
}

/** Resolves the UI locale for the current request: cookie first, then Accept-Language. */
export async function getRequestLocale(): Promise<RequestLocale> {
  const cookieStore = await cookies();
  const cookieValue = decodeURIComponent(cookieStore.get(LOCALE_COOKIE_NAME)?.value || "").trim();
  if (isSupportedLocale(cookieValue)) {
    return { locale: cookieValue, fromCookie: true };
  }
  const headerStore = await headers();
  return { locale: matchLocale(headerStore.get("accept-language")) ?? DEFAULT_LOCALE, fromCookie: false };
}

export async function getServerTranslator() {
  const { locale } = await getRequestLocale();
  const messages = getMessages(locale);
  return { locale, messages, ...createTranslator(messages) };
}
