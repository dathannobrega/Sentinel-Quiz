import { SessionResultShell } from "@/features/results/components/session-result-shell";

export default async function ExamResultPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionResultShell mode="exam" sessionId={sessionId} />;
}
