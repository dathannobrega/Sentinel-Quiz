"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { buttonClassName } from "@/components/ui/button";
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
    <Alert
      tone="warning"
      role="alert"
      title={title ?? t("system.authRequired.title")}
      message={message ?? t("system.authRequired.message")}
      action={
        <Link href={`/login?next=${encodeURIComponent(next)}`} className={buttonClassName("primary", "sm")}>
          {t("system.authRequired.signIn")}
        </Link>
      }
    />
  );
}
