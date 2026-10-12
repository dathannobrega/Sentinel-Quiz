import type { Metadata } from "next";

import { Reader } from "@/features/reading/components/reader";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("system.metadata.read"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  return <Reader sectionId={decodeURIComponent(sectionId)} />;
}
