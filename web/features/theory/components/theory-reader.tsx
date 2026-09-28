"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AuthRequiredNotice } from "@/components/ui/auth-required-notice";
import { Card } from "@/components/ui/card";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiClient } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useCurrentUser } from "@/lib/query/hooks";
import { buildMaterialPreviewPath, sanitizeMaterialPreviewHtml } from "@/lib/utils/materials";
import type { CitationItem } from "@/types/api";

export interface TheoryReaderProps {
  materialPath: string;
  locator?: string;
  pageStart?: string;
  pageEnd?: string;
  label?: string;
}

function buildPageLabel(t: (key: string, values?: Record<string, string | number>) => string, start?: string, end?: string) {
  const from = String(start || "").trim();
  const to = String(end || "").trim();
  if (from && to && from !== to) {
    return t("theory.pages", { start: from, end: to });
  }
  if (from) {
    return t("theory.page", { start: from });
  }
  return null;
}

export function TheoryReader({ materialPath, locator, pageStart, pageEnd, label }: TheoryReaderProps) {
  const { t } = useI18n();
  const currentUserQuery = useCurrentUser();
  const isAuthenticated = Boolean(currentUserQuery.data);

  const previewPath = useMemo(() => {
    const citation: CitationItem = {
      material_path: materialPath,
      locator: locator || undefined,
      page_start: pageStart || undefined,
      page_end: pageEnd || undefined
    };
    return materialPath ? buildMaterialPreviewPath(citation) : null;
  }, [locator, materialPath, pageEnd, pageStart]);

  // The preview endpoint requires an authenticated user (contract §4): fetch it with the
  // session cookie and render the HTML in a sandboxed iframe (no scripts, no download links).
  const previewQuery = useQuery({
    queryKey: ["material-preview", previewPath],
    queryFn: async ({ signal }) => sanitizeMaterialPreviewHtml(await apiClient.getText(previewPath as string, { signal })),
    enabled: Boolean(previewPath) && isAuthenticated,
    staleTime: 10 * 60_000
  });

  const title = label || t("theory.title");
  const pageLabel = buildPageLabel(t, pageStart, pageEnd);
  const previewError = previewQuery.error;
  const needsLogin =
    (currentUserQuery.isFetched && !isAuthenticated) || (previewError instanceof ApiError && previewError.status === 401);
  const isNotFound = previewError instanceof ApiError && previewError.status === 404;

  let body: React.ReactNode;
  if (!previewPath) {
    body = <div className="sq-empty" style={{ padding: "var(--sq-space-6)" }}>{t("theory.noMaterial")}</div>;
  } else if (currentUserQuery.isPending || (previewQuery.isPending && previewQuery.isFetching)) {
    body = (
      <div role="status" aria-busy="true" style={{ padding: "var(--sq-space-4)" }}>
        <span className="sq-visually-hidden">{t("theory.loading")}</span>
        <Skeleton height={420} />
      </div>
    );
  } else if (needsLogin) {
    body = (
      <div style={{ padding: "var(--sq-space-4)" }}>
        <AuthRequiredNotice title={t("theory.loginRequiredTitle")} message={t("theory.loginRequiredMessage")} />
      </div>
    );
  } else if (isNotFound) {
    body = <div className="sq-empty" style={{ padding: "var(--sq-space-6)" }}>{t("theory.notFound")}</div>;
  } else if (previewQuery.isError) {
    body = (
      <div style={{ padding: "var(--sq-space-4)" }}>
        <QueryErrorBanner
          title={t("theory.loadFailed")}
          error={previewQuery.error}
          onRetry={() => void previewQuery.refetch()}
          retrying={previewQuery.isFetching}
        />
      </div>
    );
  } else {
    body = (
      <iframe
        srcDoc={previewQuery.data ?? ""}
        sandbox=""
        referrerPolicy="no-referrer"
        title={t("theory.frameTitle", { label: title })}
        style={{
          display: "block",
          width: "100%",
          minHeight: "72vh",
          border: 0,
          background: "rgba(255,255,255,0.92)"
        }}
      />
    );
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className="sq-topbar">
          <div className="sq-brand">
            <div className="sq-logo" aria-hidden="true">
              SQ
            </div>
            <div className="sq-brand-copy">
              <h1 className="sq-page-title">{t("theory.title")}</h1>
              <p className="sq-page-subtitle">{t("theory.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/review">{t("theory.reviewQueue")}</Link>
            <Link href="/dashboard">{t("theory.dashboard")}</Link>
          </div>
        </header>

        <Card title={title} subtitle={t("theory.cardSubtitle")}>
          <div className="sq-surface-block">
            <div className="sq-chip-row">
              {materialPath ? <span className="sq-chip">{materialPath.split("/").pop()}</span> : null}
              {pageLabel ? <span className="sq-chip">{pageLabel}</span> : null}
              {locator ? <span className="sq-chip">{locator}</span> : null}
            </div>
          </div>

          <div
            className="sq-surface-block"
            style={{
              marginTop: "var(--sq-space-4)",
              padding: 0,
              overflow: "hidden",
              minHeight: "72vh"
            }}
          >
            {body}
          </div>
        </Card>
      </div>
    </main>
  );
}
