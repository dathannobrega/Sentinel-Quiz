import { SessionResultShell } from "@/features/results/components/session-result-shell";

export default function StudyResultPage({
  params
}: {
  params: { sessionId: string };
}) {
  return <SessionResultShell mode="study" sessionId={params.sessionId} />;
}
