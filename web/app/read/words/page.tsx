import type { Metadata } from "next";

import { WordsPage } from "@/features/reading/components/words-page";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("system.metadata.read"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <WordsPage />;
}
