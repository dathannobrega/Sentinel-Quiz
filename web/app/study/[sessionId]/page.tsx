import { SessionRunnerShell } from "@/features/session-runner/components/session-runner-shell";

export default function StudySessionPage({
  params
}: {
  params: { sessionId: string };
}) {
  return <SessionRunnerShell mode="study" sessionId={params.sessionId} />;
}
