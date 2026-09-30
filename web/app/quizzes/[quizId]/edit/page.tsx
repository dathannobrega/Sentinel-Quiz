import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { QuizEditorShell } from "@/features/quiz-builder/components/editor/quiz-editor-shell";
import { liveAuthoringMetadata } from "@/features/quiz-builder/lib/metadata";

export const generateMetadata = liveAuthoringMetadata("quizBuilder.metadata.editor");

export default async function Page({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  return (
    <Suspense fallback={<PageSkeleton blocks={[56, 480]} />}>
      <QuizEditorShell quizId={decodeURIComponent(quizId)} />
    </Suspense>
  );
}
