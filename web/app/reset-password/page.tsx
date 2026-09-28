import { Suspense } from "react";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("resetPassword", { robots: { index: false, follow: false } });

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
