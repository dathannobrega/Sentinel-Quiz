import { SessionResultShell } from "@/features/results/components/session-result-shell";

export default async function StudyResultPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionResultShell mode="study" sessionId={sessionId} />;
}
