import { Suspense } from "react";
import type { Metadata } from "next";

import { PresentShell } from "@/features/quiz-present/components/present-shell";
import { getServerTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslator();
  return { title: t("quizPresent.meta.title"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return (
    <Suspense fallback={null}>
      <PresentShell sessionId={sessionId} />
    </Suspense>
  );
}
