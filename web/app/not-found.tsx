import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("system.notFound.title"), robots: { index: false } };
}

export default async function NotFound() {
  const { t } = await getServerTranslator();

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack sq-state-page">
        <Card className="sq-state-page__card" title={t("system.notFound.title")} subtitle={t("system.notFound.message")}>
          <div className="sq-actions">
            <Link href="/" className="sq-button sq-button--md sq-button--primary">
              {t("system.notFound.home")}
            </Link>
            <Link href="/dashboard" className="sq-button sq-button--md sq-button--ghost">
              {t("system.notFound.dashboard")}
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}
