import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { VerifyEmailPanel } from "@/features/auth/components/verify-email-panel";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("verifyEmail", { robots: { index: false, follow: false } });

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <VerifyEmailPanel />
    </Suspense>
  );
}
