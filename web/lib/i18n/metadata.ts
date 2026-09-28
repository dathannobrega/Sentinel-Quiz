import type { Metadata } from "next";

import type { LocaleMessages } from "@/lib/i18n/core";
import { getServerTranslator } from "@/lib/i18n/server";

type PageMetadataKey = keyof LocaleMessages["system"]["metadata"];

/** Per-route localized metadata: `export const generateMetadata = pageMetadata("dashboard");` */
export function pageMetadata(key: PageMetadataKey, extra?: Metadata) {
  return async function generateMetadata(): Promise<Metadata> {
    const { t } = await getServerTranslator();
    return { title: t(`system.metadata.${key}`), ...extra };
  };
}
