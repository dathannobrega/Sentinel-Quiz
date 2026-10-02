import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import { AppShell } from "@/components/navigation/app-shell";
import { getServerRuntimeConfig, serializeRuntimeConfig } from "@/lib/config/server-runtime";
import { fontVariables } from "@/lib/fonts";
import { getMessages, I18nProvider } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";
import { pwaBootScript } from "@/lib/pwa/boot";
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
    applicationName: messages.common.appName,
    // Installed on iOS ("Add to Home Screen"): standalone, short title under the icon. "default"
    // keeps the status bar readable in both themes (black-translucent is white text on any canvas).
    appleWebApp: { capable: true, title: messages.metadata.shortName, statusBarStyle: "default" },
    // iOS would turn PINs and scores into phone links.
    formatDetection: { telephone: false }
  };
}

// viewport-fit=cover: the page runs under notches / home indicators; layouts pad with
// env(safe-area-inset-*). Zoom stays enabled (accessibility). theme-color is set by the boot script
// so it follows the in-app light/dark choice, not only the OS preference.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale, fromCookie } = await getRequestLocale();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const messages = getMessages(locale);

  return (
    // data-theme is set by the boot script before hydration, hence suppressHydrationWarning.
    <html lang={locale} className={fontVariables} suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: pwaBootScript(process.env.NODE_ENV === "production") }}
        />
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
