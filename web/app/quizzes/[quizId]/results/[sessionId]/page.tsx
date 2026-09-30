import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ReportShell } from "@/features/quiz-reports/components/report-shell";
import { liveAuthoringMetadata } from "@/features/quiz-builder/lib/metadata";

export const generateMetadata = liveAuthoringMetadata("quizReports.metadata.title");

export default async function Page({ params }: { params: Promise<{ quizId: string; sessionId: string }> }) {
  const { quizId, sessionId } = await params;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportShell quizId={decodeURIComponent(quizId)} sessionId={decodeURIComponent(sessionId)} />
    </Suspense>
  );
}
