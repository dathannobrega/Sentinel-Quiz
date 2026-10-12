import type { Metadata } from "next";

import { ReadingLibrary } from "@/features/reading/components/library";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("system.metadata.read"), description: t("reading.meta.description"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <ReadingLibrary />;
}
