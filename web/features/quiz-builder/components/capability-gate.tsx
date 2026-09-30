"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { buttonClassName } from "@/components/ui/button";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { PresentIcon } from "@/features/quiz-builder/components/icons";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useLiveCapabilities } from "@/lib/query/live-hooks";
import type { LiveCannotHostReason, LiveCapabilities } from "@/types/api";

/** Resolves why the user cannot host (null = can host). A 401 or 404 on /capabilities also maps here. */
export function resolveCannotHostReason(data: LiveCapabilities | undefined, error: unknown): LiveCannotHostReason | null {
  if (error instanceof ApiError) {
    if (error.status === 401) return "auth_required";
    if (error.status === 404) return "live_disabled";
    if (error.status === 403) return "not_allowlisted";
  }
  if (!data) {
    return null;
  }
  if (!data.enabled) {
    return "live_disabled";
  }
  if (!data.can_host) {
    return data.reason ?? "not_allowlisted";
  }
  return null;
}

export function CannotHostNotice({ reason }: { reason: LiveCannotHostReason }) {
  const { t } = useI18n();
  const pathname = usePathname() || "/quizzes";
  let action: ReactNode = null;
  if (reason === "auth_required") {
    action = (
      <Link href={`/login?next=${encodeURIComponent(pathname)}`} className={buttonClassName("primary", "md")}>
        {t("quizBuilder.capabilities.auth_required.action")}
      </Link>
    );
  } else if (reason === "email_not_verified") {
    action = (
      <Link href="/settings" className={buttonClassName("primary", "md")}>
        {t("quizBuilder.capabilities.email_not_verified.action")}
      </Link>
    );
  }
  return (
    <section
      role="status"
      className="flex flex-col items-start gap-4 rounded-lg border border-line bg-surface p-6 sm:flex-row sm:p-8 motion-safe:animate-[rise-in_240ms_var(--ease-out)]"
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
        <PresentIcon size={24} />
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="text-lg font-semibold text-fg">{t(`quizBuilder.capabilities.${reason}.title`)}</h2>
        <p className="max-w-prose text-[0.9375rem] leading-relaxed text-fg-muted">{t(`quizBuilder.capabilities.${reason}.message`)}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </section>
  );
}

/**
 * Renders children only when GET /live/capabilities says the user can host; otherwise explains why.
 * Children receive the capabilities (limits, themes, item types).
 */
export function CapabilityGate({ children }: { children: (capabilities: LiveCapabilities) => ReactNode }) {
  const { t } = useI18n();
  const query = useLiveCapabilities();
  const reason = resolveCannotHostReason(query.data, query.error);

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">{t("quizBuilder.capabilities.loading")}</span>
        <Skeleton height={120} />
      </div>
    );
  }
  if (reason) {
    return <CannotHostNotice reason={reason} />;
  }
  if (query.isError || !query.data) {
    return <QueryErrorBanner error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  return <>{children(query.data)}</>;
}
