import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { StartSessionShell } from "@/features/start/components/start-session-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("start");

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StartSessionShell />
    </Suspense>
  );
}
