import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { QuizLibraryShell } from "@/features/quiz-builder/components/library/quiz-library-shell";
import { liveAuthoringMetadata } from "@/features/quiz-builder/lib/metadata";

export const generateMetadata = liveAuthoringMetadata("quizBuilder.metadata.library");

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QuizLibraryShell />
    </Suspense>
  );
}
