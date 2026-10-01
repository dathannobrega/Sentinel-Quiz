import type { Metadata } from "next";

import { ChallengeFlow } from "@/features/quiz-challenge/components/challenge-flow";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("quizChallenge.meta.playTitle"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ChallengeFlow rawSlug={decodeURIComponent(slug)} />;
}
