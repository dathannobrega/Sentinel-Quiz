"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { StatusBanner } from "@/components/ui/status-banner";
import { useI18n } from "@/lib/i18n";

interface AuthRequiredNoticeProps {
  title?: string;
  message?: string;
  /** Where to return after login. Defaults to the current path. */
  nextPath?: string;
}

export function AuthRequiredNotice({ title, message, nextPath }: AuthRequiredNoticeProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const next = nextPath ?? pathname ?? "/dashboard";

  return (
    <StatusBanner
      tone="warning"
      role="alert"
      title={title ?? t("system.authRequired.title")}
      message={message ?? t("system.authRequired.message")}
      action={
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="sq-button sq-button--sm sq-button--primary">
          {t("system.authRequired.signIn")}
        </Link>
      }
    />
  );
}
