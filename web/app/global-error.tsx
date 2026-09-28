"use client";

import { useEffect, useState } from "react";

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
        <main className="sq-app-shell">
          <div className="sq-page-stack sq-state-page">
            <section className="sq-card sq-state-page__card" role="alert">
              <h1 className="sq-section-title">{copy.title}</h1>
              <p className="sq-list-meta">{copy.message}</p>
              {error.digest ? <p className="sq-list-meta">{copy.reference.replace("{digest}", error.digest)}</p> : null}
              <div className="sq-actions">
                <button type="button" className="sq-button sq-button--md sq-button--primary" onClick={() => reset()}>
                  {copy.retry}
                </button>
                {/* Full reload on purpose: the root layout itself failed. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/" className="sq-button sq-button--md sq-button--ghost">
                  {copy.home}
                </a>
              </div>
            </section>
          </div>
        </main>
      </body>
    </html>
  );
}
