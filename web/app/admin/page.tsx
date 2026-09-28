import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { AdminShell } from "@/features/admin/components/admin-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("admin", { robots: { index: false, follow: false } });

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminShell />
    </Suspense>
  );
}
