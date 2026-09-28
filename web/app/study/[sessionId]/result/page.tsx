import { SessionResultShell } from "@/features/results/components/session-result-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("studyResult", { robots: { index: false, follow: false } });

export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <SessionResultShell mode="study" sessionId={sessionId} />;
}
