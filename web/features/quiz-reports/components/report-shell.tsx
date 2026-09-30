"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertIcon, ArrowLeftIcon } from "@/components/ui/icons";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { DownloadIcon, PrinterIcon } from "@/features/quiz-builder/components/icons";
import { RehearsalBadge, SessionStatusBadge } from "@/features/quiz-builder/components/sessions/quiz-sessions-shell";
import { DomainBars } from "@/features/quiz-reports/components/domain-bars";
import { InfoTip } from "@/features/quiz-reports/components/info-tip";
import { ItemAnalysis } from "@/features/quiz-reports/components/item-analysis";
import { ParticipantsTable } from "@/features/quiz-reports/components/participants-table";
import {
  formatDecimal,
  formatDuration,
  formatInteger,
  formatPercent,
  pctValue,
  rateToPercent,
  reliabilityBand
} from "@/features/quiz-reports/lib/report-format";
import { downloadSessionCsv } from "@/lib/api/live-authoring";
import { ApiError, readErrorMessage, saveBlobAsFile } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useLiveReport } from "@/lib/query/live-hooks";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { LiveReport } from "@/types/api";

import "./report-print.css";

export function ReportShell({ quizId, sessionId }: { quizId: string; sessionId: string }) {
  const { t } = useI18n();
  const report = useLiveReport(sessionId);

  return (
    <Page width="wide" data-report-print="" className="print:max-w-none print:px-0 print:pt-0">
      <Link
        href={`/quizzes/${encodeURIComponent(quizId)}/sessions`}
        className="focus-ring -mb-4 inline-flex items-center gap-1.5 self-start rounded-sm text-[0.8125rem] font-medium text-fg-muted hover:text-fg print:hidden"
      >
        <ArrowLeftIcon />
        {t("quizReports.header.back")}
      </Link>
      {report.isPending ? (
        <ReportSkeleton />
      ) : report.isError || !report.data ? (
        <QueryErrorBanner
          error={report.error}
          title={report.error instanceof ApiError && report.error.status === 404 ? t("quizReports.errors.notFound") : t("quizReports.errors.load")}
          onRetry={() => void report.refetch()}
          retrying={report.isFetching}
        />
      ) : (
        <ReportView report={report.data} refetch={() => void report.refetch()} refreshing={report.isFetching} />
      )}
    </Page>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <Skeleton height={64} className="max-w-xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} height={112} />
        ))}
      </div>
      <Skeleton height={240} />
      <Skeleton height={320} />
    </div>
  );
}

function ReportView({ report, refetch, refreshing }: { report: LiveReport; refetch: () => void; refreshing: boolean }) {
  const { t, locale } = useI18n();
  const { session, kpis } = report;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const noAnswers = kpis.participants === 0 || report.items.every((item) => item.answered === 0);
  const flagged = report.items.filter((item) => item.flags.length > 0);
  const hardest = report.items
    .filter((item) => item.scored && item.p !== null && item.answered > 0)
    .sort((a, b) => (a.p ?? 0) - (b.p ?? 0))[0];

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const file = await downloadSessionCsv(session.id);
      saveBlobAsFile(file.blob, file.filename ?? `sentinel-arena-${session.join_code}.csv`);
    } catch (error) {
      setExportError(readErrorMessage(error, t("quizReports.header.exportError")));
    } finally {
      setExporting(false);
    }
  }

  const kr20Band = reliabilityBand(kpis.kr20);
  const sections = [
    { id: "report-summary", label: t("quizReports.kpis.title") },
    ...(report.domains.length ? [{ id: "report-domains", label: t("quizReports.domains.title") }] : []),
    { id: "report-items", label: t("quizReports.items.title") },
    { id: "report-participants", label: t("quizReports.participants.title") }
  ];

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <p className="mb-1 flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg-muted">
            {t("quizReports.header.context", { code: session.join_code })}
            <SessionStatusBadge status={session.status} />
            {session.rehearsal ? <RehearsalBadge hint={t("quizReports.header.rehearsalHint")} /> : null}
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg sm:text-[1.75rem] sm:leading-tight">{session.quiz_title}</h1>
          <p className="mt-2 text-[0.9375rem] text-fg-muted">
            {t("quizReports.header.meta", {
              version: session.version_no,
              date: formatDateTime(session.started_at ?? session.created_at, locale)
            })}
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">{t("quizReports.header.generated", { date: formatDateTime(report.generated_at, locale) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="secondary" onClick={() => window.print()}>
            <PrinterIcon />
            {t("quizReports.header.print")}
          </Button>
          <Button onClick={() => void exportCsv()} busy={exporting} busyLabel={t("quizReports.header.exporting")}>
            <DownloadIcon />
            {t("quizReports.header.exportCsv")}
          </Button>
        </div>
      </header>

      {exportError ? <Alert tone="danger" role="alert" message={exportError} /> : null}
      {session.status !== "finished" ? (
        <Alert
          tone="warning"
          message={t("quizReports.header.live")}
          action={
            <Button size="sm" variant="secondary" onClick={refetch} busy={refreshing}>
              {t("quizReports.header.refresh")}
            </Button>
          }
        />
      ) : null}

      <nav aria-label={t("quizReports.header.sections")} className="-mt-2 flex flex-wrap gap-1 print:hidden">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="focus-ring rounded-full border border-line px-3 py-1 text-[0.8125rem] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            {section.label}
          </a>
        ))}
      </nav>

      <ReportSection id="report-summary" title={t("quizReports.kpis.title")}>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 print:grid-cols-5">
          <KpiTile index={0} label={t("quizReports.kpis.participants")} value={formatInteger(kpis.participants, locale)} />
          <KpiTile
            index={1}
            label={t("quizReports.kpis.completion")}
            value={formatPercent(pctValue(kpis.completion_rate), locale)}
            meta={`${t("quizReports.kpis.completionMeta")} · ${t("quizReports.kpis.engagement", {
              value: formatPercent(pctValue(kpis.answered_rate), locale)
            })}`}
            meter={pctValue(kpis.completion_rate)}
          />
          <KpiTile
            index={2}
            label={t("quizReports.kpis.avgScore")}
            value={formatPercent(pctValue(kpis.avg_score_pct), locale)}
            meta={t("quizReports.kpis.median", { value: formatPercent(pctValue(kpis.median_score_pct), locale) })}
            meter={pctValue(kpis.avg_score_pct)}
          />
          <KpiTile index={3} label={t("quizReports.kpis.avgTime")} value={formatDuration(kpis.avg_response_ms, locale)} />
          <KpiTile
            index={4}
            label={
              <span className="inline-flex items-center gap-1">
                {t("quizReports.kpis.kr20")}
                <InfoTip label={t("quizReports.kpis.kr20Help")}>{t("quizReports.kpis.kr20Explanation")}</InfoTip>
              </span>
            }
            value={kpis.kr20 === null ? "–" : formatDecimal(kpis.kr20, locale)}
            meta={
              kpis.kr20 === null
                ? t("quizReports.kpis.insufficient")
                : kr20Band === "acceptable"
                  ? t("quizReports.kpis.kr20Acceptable")
                  : t("quizReports.kpis.kr20Low")
            }
          />
        </dl>

        {noAnswers ? (
          <div className="rounded-lg border border-dashed border-line-strong px-5 py-8 text-center">
            <p className="font-medium text-fg">{t("quizReports.empty.title")}</p>
            <p className="mt-1 text-sm text-fg-muted">{t("quizReports.empty.message")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 rounded-lg bg-surface-muted px-4 py-3 text-sm">
            <p className="font-semibold text-fg">{t("quizReports.highlights.title")}</p>
            <p className="flex items-center gap-2 text-fg">
              {flagged.length ? <AlertIcon className="text-warning" /> : null}
              {flagged.length ? t("quizReports.highlights.flagged", { count: flagged.length }) : t("quizReports.highlights.none")}
            </p>
            {hardest ? (
              <p className="text-fg-muted">
                {t("quizReports.highlights.hardest", {
                  position: hardest.position + 1,
                  value: formatPercent(rateToPercent(hardest.p), locale)
                })}
              </p>
            ) : null}
          </div>
        )}
      </ReportSection>

      {report.domains.length ? (
        <ReportSection id="report-domains" title={t("quizReports.domains.title")} description={t("quizReports.domains.description")}>
          <DomainBars domains={report.domains} />
        </ReportSection>
      ) : null}

      <ReportSection id="report-items" title={t("quizReports.items.title")} description={t("quizReports.items.description")}>
        <ItemAnalysis items={report.items} />
      </ReportSection>

      <ReportSection
        id="report-participants"
        title={t("quizReports.participants.title")}
        description={t("quizReports.participants.description")}
        actions={<Badge tone="neutral">{formatInteger(report.participants.length, locale)}</Badge>}
      >
        {report.participants.length ? (
          <ParticipantsTable participants={report.participants} scoredItems={report.kpis.scored_items} />
        ) : (
          <p className="rounded-lg border border-dashed border-line-strong px-5 py-6 text-sm text-fg-muted">{t("quizReports.participants.none")}</p>
        )}
      </ReportSection>
    </>
  );
}

function ReportSection({
  id,
  title,
  description,
  actions,
  children
}: {
  id: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-6 flex-col gap-4 motion-safe:animate-[rise-in_360ms_var(--ease-out)_both] print:break-inside-avoid-page"
    >
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={`${id}-title`} className="text-lg font-semibold text-fg">
            {title}
          </h2>
          {description ? <p className="mt-0.5 max-w-prose text-[0.8125rem] text-fg-muted">{description}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function KpiTile({
  label,
  value,
  meta,
  meter,
  index
}: {
  label: ReactNode;
  value: string;
  meta?: string;
  meter?: number | null;
  index: number;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface p-4 motion-safe:animate-[rise-in_320ms_var(--ease-out)_both] print:border-line-strong"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <dt className="text-[0.8125rem] text-fg-muted">{label}</dt>
      <dd className="nums text-[1.75rem] leading-none font-semibold tracking-tight text-fg motion-safe:animate-[pop-in_420ms_var(--ease-out)_both]" style={{ animationDelay: `${index * 60 + 120}ms` }}>
        {value}
      </dd>
      {meter !== undefined && meter !== null ? (
        <dd aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <span
            className="block h-full origin-left rounded-full bg-primary motion-safe:animate-[grow-x_700ms_var(--ease-out)_both]"
            style={{ width: `${Math.max(0, Math.min(100, meter))}%`, animationDelay: `${index * 60 + 150}ms` }}
          />
        </dd>
      ) : null}
      {meta ? <dd className={cn("text-xs leading-snug text-fg-muted")}>{meta}</dd> : null}
    </div>
  );
}
