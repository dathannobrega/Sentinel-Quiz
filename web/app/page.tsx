import type { Metadata } from "next";

import { LandingPageShell } from "@/features/marketing/components/landing-page-shell";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return {
    title: { absolute: t("metadata.title") },
    description: t("metadata.description"),
    openGraph: { title: t("metadata.title"), description: t("metadata.description"), type: "website" }
  };
}

export default function HomePage() {
  return <LandingPageShell />;
}
