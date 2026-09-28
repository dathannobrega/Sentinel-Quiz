import { SessionRunnerShell } from "@/features/session-runner/components/session-runner-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("study", { robots: { index: false, follow: false } });

export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <SessionRunnerShell mode="study" sessionId={sessionId} />;
}
