import type { ReactNode } from "react";
import type { Metadata } from "next";

import { AppNavbar } from "@/components/navigation/app-navbar";

import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sentinel Quiz | Security+ e CISSP",
  description:
    "Treine para Security+ e CISSP com simulados, estudo guiado, revisao inteligente e metricas por dominio."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const runtimeConfig = {
    apiOrigin: String(process.env.NEXT_PUBLIC_API_ORIGIN || "").trim().replace(/\/$/, "")
  };
  const runtimeConfigScript = JSON.stringify(runtimeConfig).replace(/</g, "\\u003c");

  return (
    <html lang="pt-BR">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__SENTINEL_RUNTIME__ = ${runtimeConfigScript};`
          }}
        />
        <AppNavbar />
        {children}
      </body>
    </html>
  );
}
