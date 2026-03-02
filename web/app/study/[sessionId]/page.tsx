import { SessionRunnerShell } from "@/features/session-runner/components/session-runner-shell";

export default async function StudySessionPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionRunnerShell mode="study" sessionId={sessionId} />;
}
