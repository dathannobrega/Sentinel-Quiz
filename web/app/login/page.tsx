import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("login");

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuthShell mode="login" />
    </Suspense>
  );
}
