import { SessionResultShell } from "@/features/results/components/session-result-shell";

export default function ExamResultPage({
  params
}: {
  params: { sessionId: string };
}) {
  return <SessionResultShell mode="exam" sessionId={params.sessionId} />;
}
