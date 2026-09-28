import type { ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { AppNavbar } from "@/components/navigation/app-navbar";
import { getServerRuntimeConfig, serializeRuntimeConfig } from "@/lib/config/server-runtime";
import { getMessages, I18nProvider } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";
import { AppQueryProvider } from "@/lib/query/provider";

import "./globals.css";

// No global `force-dynamic`: the layout reads per-request data (locale cookie, CSP nonce and the
// runtime API origin) through dynamic APIs, which already opts the tree into request-time rendering.

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getRequestLocale();
  const messages = getMessages(locale);
  return {
    title: {
      default: messages.metadata.title,
      template: `%s · ${messages.common.appName}`
    },
    description: messages.metadata.description,
    applicationName: messages.common.appName
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale, fromCookie } = await getRequestLocale();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const messages = getMessages(locale);

  return (
    <html lang={locale}>
      <body>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: serializeRuntimeConfig(getServerRuntimeConfig()) }}
        />
        <a href="#main-content" className="sq-skip-link">
          {messages.navigation.skipToContent}
        </a>
        <I18nProvider locale={locale} localeFromCookie={fromCookie}>
          <AppQueryProvider>
            <AppNavbar />
            <div id="main-content" tabIndex={-1}>
              {children}
            </div>
          </AppQueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
