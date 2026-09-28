import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { AdminShell } from "@/features/admin/components/admin-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("adminEditor", { robots: { index: false, follow: false } });

export default async function Page({ params }: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await params;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminShell editorOnly initialQuestionId={decodeURIComponent(questionId)} />
    </Suspense>
  );
}
