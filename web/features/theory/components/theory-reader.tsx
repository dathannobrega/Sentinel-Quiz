"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AuthRequiredNotice } from "@/components/ui/auth-required-notice";
import { EmptyState } from "@/components/ui/empty-state";
import { BookIcon } from "@/components/ui/icons";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page, PageHeader } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiClient } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useCurrentUser } from "@/lib/query/hooks";
import { useTheme } from "@/lib/theme/theme";
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

/**
 * The preview HTML comes from the backend with its own (legacy, light-only) stylesheet. Append a
 * reading stylesheet built from the resolved design tokens so the excerpt follows the product's
 * typography and the active theme, and hide the header the page already shows.
 * `_preference` only keys the memo; the values come from the computed tokens.
 */
function withReaderStyles(html: string, _preference: string): string {
  if (typeof window === "undefined") {
    return html;
  }
  const tokens = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => tokens.getPropertyValue(name).trim() || fallback;
  const fg = read("--sq-fg", "#161a22");
  const css = [
    `html, body { background: ${read("--sq-canvas", "#f4f5f7")} !important; color: ${fg} !important; }`,
    `body { font-family: "Source Serif 4", Georgia, "Times New Roman", serif !important; -webkit-font-smoothing: antialiased; }`,
    "main { max-width: 44rem !important; margin: 0 !important; padding: 0 0 48px !important; }",
    "main > .eyebrow, main > h1, main > .meta { display: none !important; }",
    ".card { background: transparent !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; border-radius: 0 !important; }",
    `.body p, .body li { font-size: 18px !important; line-height: 1.7 !important; color: ${fg} !important; }`,
    `a { color: ${read("--sq-primary", "#2544c4")} !important; }`
  ].join("\n");
  const style = `<style>${css}</style>`;
  return html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : `${style}${html}`;
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
  const { preference } = useTheme();
  const previewHtml = previewQuery.data;
  // Rebuilt when the theme preference changes: colors are read from the resolved tokens.
  const themedDocument = useMemo(() => (previewHtml ? withReaderStyles(previewHtml, preference) : ""), [previewHtml, preference]);
  const pageLabel = buildPageLabel(t, pageStart, pageEnd);
  const previewError = previewQuery.error;
  const needsLogin =
    (currentUserQuery.isFetched && !isAuthenticated) || (previewError instanceof ApiError && previewError.status === 401);
  const isNotFound = previewError instanceof ApiError && previewError.status === 404;

  let body: React.ReactNode;
  if (!previewPath) {
    body = <EmptyState description={t("theory.noMaterial")} />;
  } else if (currentUserQuery.isPending || (previewQuery.isPending && previewQuery.isFetching)) {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">{t("theory.loading")}</span>
        <Skeleton height={24} className="max-w-md" />
        <Skeleton height={18} />
        <Skeleton height={18} />
        <Skeleton height={18} className="max-w-lg" />
        <Skeleton height={320} />
      </div>
    );
  } else if (needsLogin) {
    body = <AuthRequiredNotice title={t("theory.loginRequiredTitle")} message={t("theory.loginRequiredMessage")} />;
  } else if (isNotFound) {
    body = <EmptyState description={t("theory.notFound")} />;
  } else if (previewQuery.isError) {
    body = (
      <QueryErrorBanner
        title={t("theory.loadFailed")}
        error={previewQuery.error}
        onRetry={() => void previewQuery.refetch()}
        retrying={previewQuery.isFetching}
      />
    );
  } else {
    body = (
      <iframe
        srcDoc={themedDocument}
        sandbox=""
        referrerPolicy="no-referrer"
        title={t("theory.frameTitle", { label: title })}
        className="block min-h-[72vh] w-full border-0 bg-canvas"
      />
    );
  }

  const meta = [materialPath ? materialPath.split("/").pop() : null, pageLabel, locator].filter(Boolean).join(" · ");

  return (
    <Page>
      <div className="flex w-full max-w-[52rem] flex-col gap-8">
      <PageHeader
        context={t("theory.title")}
        title={title}
        description={t("theory.cardSubtitle")}
        actions={
          <nav aria-label={t("theory.title")} className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link href="/review" className="focus-ring rounded-sm font-medium text-primary underline-offset-2 hover:underline">
              {t("theory.reviewQueue")}
            </Link>
            <Link href="/dashboard" className="focus-ring rounded-sm font-medium text-primary underline-offset-2 hover:underline">
              {t("theory.dashboard")}
            </Link>
          </nav>
        }
      />
      {meta ? (
        <p className="-mt-4 flex items-center gap-2 font-mono text-xs text-fg-subtle [overflow-wrap:anywhere]">
          <BookIcon className="shrink-0" />
          {meta}
        </p>
      ) : null}
      <div className="border-t border-line pt-6">{body}</div>
      </div>
    </Page>
  );
}
