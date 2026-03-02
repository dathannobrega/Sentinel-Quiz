import { SessionRunnerShell } from "@/features/session-runner/components/session-runner-shell";

export default async function ExamSessionPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionRunnerShell mode="exam" sessionId={sessionId} />;
}
