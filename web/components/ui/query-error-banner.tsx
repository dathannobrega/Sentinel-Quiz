"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
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
    <StatusBanner
      tone={tone}
      role="alert"
      className={className}
      title={title ?? t("system.loadFailed.title")}
      message={message}
      action={
        <>
          {onRetry ? (
            <Button variant="ghost" size="sm" busy={retrying} onClick={() => onRetry()}>
              {t("system.loadFailed.retry")}
            </Button>
          ) : null}
          {isUnauthorized ? (
            <Link href="/login" className="sq-button sq-button--sm sq-button--primary">
              {t("system.authRequired.signIn")}
            </Link>
          ) : null}
        </>
      }
    />
  );
}
