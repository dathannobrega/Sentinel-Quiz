import type { ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { AppShell } from "@/components/navigation/app-shell";
import { getServerRuntimeConfig, serializeRuntimeConfig } from "@/lib/config/server-runtime";
import { fontVariables } from "@/lib/fonts";
import { getMessages, I18nProvider } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";
import { AppQueryProvider } from "@/lib/query/provider";
import { themeBootScript } from "@/lib/theme/boot";

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
    // data-theme is set by the boot script before hydration, hence suppressHydrationWarning.
    <html lang={locale} className={fontVariables} suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: serializeRuntimeConfig(getServerRuntimeConfig()) }}
        />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:shadow-overlay"
        >
          {messages.navigation.skipToContent}
        </a>
        <I18nProvider locale={locale} localeFromCookie={fromCookie}>
          <AppQueryProvider>
            <AppShell>{children}</AppShell>
          </AppQueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
