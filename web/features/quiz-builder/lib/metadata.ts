import type { Metadata } from "next";

import { getServerTranslator } from "@/lib/i18n/server";

/** Localized <title> for the Sentinel Arena authoring/report routes (never indexed: private data). */
export function liveAuthoringMetadata(key: string) {
  return async function generateMetadata(): Promise<Metadata> {
    const { t } = await getServerTranslator();
    return { title: t(key), robots: { index: false, follow: false } };
  };
}
