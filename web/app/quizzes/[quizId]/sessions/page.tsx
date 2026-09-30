import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { QuizSessionsShell } from "@/features/quiz-builder/components/sessions/quiz-sessions-shell";
import { liveAuthoringMetadata } from "@/features/quiz-builder/lib/metadata";

export const generateMetadata = liveAuthoringMetadata("quizBuilder.metadata.sessions");

export default async function Page({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QuizSessionsShell quizId={decodeURIComponent(quizId)} />
    </Suspense>
  );
}
