import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@/components/ui/button-styles";
import { StatePage } from "@/components/ui/state-page";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("system.notFound.title"), robots: { index: false } };
}

export default async function NotFound() {
  const { t } = await getServerTranslator();

  return (
    <StatePage
      code="404"
      title={t("system.notFound.title")}
      message={t("system.notFound.message")}
      actions={
        <>
          <Link href="/dashboard" className={buttonClassName("primary")}>
            {t("system.notFound.dashboard")}
          </Link>
          <Link href="/" className={buttonClassName("secondary")}>
            {t("system.notFound.home")}
          </Link>
        </>
      }
    />
  );
}
