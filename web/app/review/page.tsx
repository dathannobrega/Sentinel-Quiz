import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ReviewShell } from "@/features/review/components/review-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("review");

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReviewShell />
    </Suspense>
  );
}
