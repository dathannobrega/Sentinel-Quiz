import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { liveAuthoringMetadata } from "@/features/quiz-builder/lib/metadata";
import { ChallengePanelShell } from "@/features/quiz-challenge/components/challenge-panel";

export const generateMetadata = liveAuthoringMetadata("quizChallenge.meta.panelTitle");

/** Owner panel of a self-paced challenge (Incremento 6, RF-809). */
export default async function Page({ params }: { params: Promise<{ quizId: string; sessionId: string }> }) {
  const { quizId, sessionId } = await params;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChallengePanelShell quizId={decodeURIComponent(quizId)} sessionId={decodeURIComponent(sessionId)} />
    </Suspense>
  );
}
