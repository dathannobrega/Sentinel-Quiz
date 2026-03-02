import { SessionRunnerShell } from "@/features/session-runner/components/session-runner-shell";

export default function ExamSessionPage({
  params
}: {
  params: { sessionId: string };
}) {
  return <SessionRunnerShell mode="exam" sessionId={params.sessionId} />;
}
