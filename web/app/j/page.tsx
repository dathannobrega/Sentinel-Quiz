import type { Metadata } from "next";

import { CodeEntry } from "@/features/quiz-play/components/code-entry";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("quizPlay.meta.entryTitle"), robots: { index: false, follow: false } };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ pin?: string | string[] }> }) {
  const { pin } = await searchParams;
  return <CodeEntry initialCode={typeof pin === "string" ? pin : ""} />;
}
