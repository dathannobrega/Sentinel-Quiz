import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { HistoryShell } from "@/features/history/components/history-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("history");

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HistoryShell />
    </Suspense>
  );
}
