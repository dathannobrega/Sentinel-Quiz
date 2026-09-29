"use client";

import { useEffect, useState } from "react";

import { buttonClassName } from "@/components/ui/button";
import { getMessages, matchLocale, type AppLocale } from "@/lib/i18n/core";

import "./globals.css";

/**
 * Last-resort boundary: replaces the root layout, so no providers are available here.
 * Picks the locale from <html lang>/navigator and reads the catalog directly.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale, setLocale] = useState<AppLocale>("pt-BR");

  useEffect(() => {
    console.error(error);
    setLocale(matchLocale(document.documentElement.lang) ?? matchLocale(navigator.language) ?? "pt-BR");
  }, [error]);

  const copy = getMessages(locale).system.errorBoundary;

  return (
    <html lang={locale}>
      <body>
        <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-4 py-16 sm:px-6">
          <div role="alert" className="flex flex-col gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{copy.title}</h1>
            <p className="text-[0.9375rem] leading-relaxed text-fg-muted">{copy.message}</p>
            {error.digest ? <p className="font-mono text-xs text-fg-subtle">{copy.reference.replace("{digest}", error.digest)}</p> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={buttonClassName("primary")} onClick={() => reset()}>
              {copy.retry}
            </button>
            {/* Full reload on purpose: the root layout itself failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className={buttonClassName("secondary")}>
              {copy.home}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
