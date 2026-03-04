import type { ReactNode } from "react";
import type { Metadata } from "next";

import { AppNavbar } from "@/components/navigation/app-navbar";
import { getMessages, I18nProvider, type AppLocale } from "@/lib/i18n";
import { AppQueryProvider } from "@/lib/query/provider";

import "./globals.css";

export const dynamic = "force-dynamic";

const defaultLocale: AppLocale = "pt-BR";
const messages = getMessages(defaultLocale);

export const metadata: Metadata = {
  title: messages.metadata.title,
  description: messages.metadata.description
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const runtimeConfig = {
    apiOrigin: String(process.env.NEXT_PUBLIC_API_ORIGIN || "").trim().replace(/\/$/, "")
  };
  const runtimeConfigScript = JSON.stringify(runtimeConfig).replace(/</g, "\\u003c");

  return (
    <html lang={defaultLocale}>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__SENTINEL_RUNTIME__ = ${runtimeConfigScript};`
          }}
        />
        <I18nProvider locale={defaultLocale} messages={messages}>
          <AppQueryProvider>
            <AppNavbar />
            {children}
          </AppQueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
