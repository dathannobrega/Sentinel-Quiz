"use client";

import Link from "next/link";

import { Button, buttonClassName } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ApiError, readErrorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n";

interface QueryErrorBannerProps {
  error: unknown;
  title?: string;
  /** Usually `query.refetch`. Renders a "Try again" button when provided. */
  onRetry?: () => void;
  retrying?: boolean;
  tone?: "warning" | "danger";
  className?: string;
}

/** Error banner with a retry action and a sign-in link when the failure is a 401. */
export function QueryErrorBanner({ error, title, onRetry, retrying = false, tone = "danger", className }: QueryErrorBannerProps) {
  const { t } = useI18n();
  const message = readErrorMessage(error, t("api.unexpected"));
  const isUnauthorized = error instanceof ApiError && error.status === 401;

  return (
    <Alert
      tone={tone}
      role="alert"
      className={className}
      title={title ?? t("system.loadFailed.title")}
      message={message}
      action={
        <>
          {onRetry ? (
            <Button variant="secondary" size="sm" busy={retrying} onClick={() => onRetry()}>
              {t("system.loadFailed.retry")}
            </Button>
          ) : null}
          {isUnauthorized ? (
            <Link href="/login" className={buttonClassName("primary", "sm")}>
              {t("system.authRequired.signIn")}
            </Link>
          ) : null}
        </>
      }
    />
  );
}
