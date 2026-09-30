import type { Metadata } from "next";

import { JoinFlow } from "@/features/quiz-play/components/join-flow";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("quizPlay.meta.roomTitle"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinFlow rawCode={code} />;
}
