"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Section } from "@/components/ui/section";
import { formatJoinCode } from "@/features/quiz-live/lib/protocol";
import { caseActionsFor, CASE_ACTIONS_REQUIRING_NOTE, toLiveAdminErrorCode } from "@/lib/api/live-admin";
import { useI18n } from "@/lib/i18n";
import { useLiveAdminCases, useResolveLiveCase } from "@/lib/query/live-admin-hooks";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { LiveCaseAction, LiveCaseStatusFilter, LiveModerationCase } from "@/types/api";

import { ReasonDialog } from "@/features/admin/components/arena/reason-dialog";

const PAGE_SIZE = 20;
const STATUS_FILTERS: LiveCaseStatusFilter[] = ["open", "actioned", "dismissed", "all"];
const KNOWN_REASONS = new Set(["offensive", "spam", "cheating", "copyright", "privacy", "other", "filter_match"]);
const SOURCE_TONE: Record<string, BadgeTone> = { participant: "danger", filter: "warning", admin: "primary" };

interface Finding {
  position: number | null;
  field: string;
  term: string;
}

/** `details.findings` of a filter case, defensively typed (the details blob is free-form). */
function caseFindings(details: Record<string, unknown>): Finding[] {
  const raw = details.findings;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      position: typeof entry.position === "number" ? entry.position : null,
      field: typeof entry.field === "string" ? entry.field : "",
      term: typeof entry.term === "string" ? entry.term : ""
    }));
}

/** RF-1114: participant reports and filter matches, resolved by moderators (end/block: admin). */
export function ArenaQueue({ canAdmin }: { canAdmin: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<LiveCaseStatusFilter>("open");
  const [page, setPage] = useState(0);
  const cases = useLiveAdminCases({ status, limit: PAGE_SIZE, offset: page * PAGE_SIZE }, { enabled: true });
  const resolve = useResolveLiveCase();
  const [pending, setPending] = useState<{ item: LiveModerationCase; action: LiveCaseAction } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = cases.data?.items ?? [];
  const total = cases.data?.total ?? 0;
  const from = total ? page * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * PAGE_SIZE + items.length);

  function confirm(note: string) {
    if (!pending) {
      return;
    }
    setActionError(null);
    resolve.mutate(
      { caseId: pending.item.id, action: pending.action, note },
      {
        onSuccess: (result) => {
          setPending(null);
          const affected = result?.sessions_affected?.length ?? 0;
          setNotice(affected ? t("admin.arena.queue.doneSessions", { count: affected }) : t("admin.arena.queue.done"));
        },
        onError: (error) => setActionError(t(`admin.arena.errors.${toLiveAdminErrorCode(error)}`))
      }
    );
  }

  return (
    <Section
      title={t("admin.arena.queue.title")}
      description={t("admin.arena.queue.subtitle")}
      actions={
        <div className="w-44">
          <Field label={t("admin.arena.queue.statusFilter")} htmlFor="arena-case-status" hintMode="none">
            <Select
              id="arena-case-status"
              className="h-9"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as LiveCaseStatusFilter);
                setPage(0);
                setNotice(null);
              }}
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.arena.queue.statuses.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      }
    >
      {notice ? <Alert tone="success" message={notice} /> : null}
      {cases.isPending ? (
        <p role="status" className="text-sm text-fg-muted">
          {t("admin.arena.common.loading")}
        </p>
      ) : cases.isError ? (
        <QueryErrorBanner error={cases.error} title={t("admin.arena.queue.loadError")} onRetry={() => void cases.refetch()} retrying={cases.isFetching} />
      ) : items.length ? (
        <>
          <p className="text-xs text-fg-muted" role="status" aria-live="polite">
            {t("admin.arena.queue.total", { count: total })}
          </p>
          <ul className={cn("grid gap-3 lg:grid-cols-2", cases.isFetching && "opacity-70 transition-opacity")} aria-busy={cases.isFetching || undefined}>
            {items.map((item) => (
              <CaseCard
                key={item.id}
                item={item}
                canAdmin={canAdmin}
                onAction={(action) => {
                  setActionError(null);
                  setNotice(null);
                  setPending({ item, action });
                }}
              />
            ))}
          </ul>
          {total > PAGE_SIZE ? (
            <nav className="flex flex-wrap items-center justify-between gap-2" aria-label={t("admin.arena.queue.title")}>
              <Button variant="secondary" size="sm" disabled={page === 0 || cases.isFetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                {t("admin.arena.queue.previous")}
              </Button>
              <span className="nums text-xs text-fg-muted">{t("admin.arena.queue.page", { from, to, total })}</span>
              <Button variant="secondary" size="sm" disabled={to >= total || cases.isFetching} onClick={() => setPage((value) => value + 1)}>
                {t("admin.arena.queue.next")}
              </Button>
            </nav>
          ) : null}
        </>
      ) : (
        <EmptyState size="compact" description={t("admin.arena.queue.empty")} />
      )}
      <ReasonDialog
        open={pending !== null}
        title={pending ? t(`admin.arena.queue.actions.${pending.action}`) : ""}
        message={pending ? t(`admin.arena.queue.actionText.${pending.action}`) : ""}
        label={t("admin.arena.queue.noteLabel")}
        hint={pending && CASE_ACTIONS_REQUIRING_NOTE.has(pending.action) ? t("admin.arena.common.reasonHint") : t("admin.arena.queue.noteOptional")}
        required={pending ? CASE_ACTIONS_REQUIRING_NOTE.has(pending.action) : false}
        tone={pending && CASE_ACTIONS_REQUIRING_NOTE.has(pending.action) ? "danger" : "primary"}
        confirmLabel={pending ? t(`admin.arena.queue.actions.${pending.action}`) : t("admin.arena.queue.confirm")}
        busy={resolve.isPending}
        error={actionError}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      />
    </Section>
  );
}

function CaseCard({
  item,
  canAdmin,
  onAction
}: {
  item: LiveModerationCase;
  canAdmin: boolean;
  onAction: (action: LiveCaseAction) => void;
}) {
  const { t, locale } = useI18n();
  const actions = caseActionsFor(item, canAdmin);
  const findings = caseFindings(item.details ?? {});
  const reasonKey = KNOWN_REASONS.has(item.reason) ? item.reason : "other";
  const titleId = `arena-case-${item.id}`;
  return (
    <li aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SOURCE_TONE[item.source] ?? "neutral"}>{t(`admin.arena.queue.sources.${item.source in SOURCE_TONE ? item.source : "admin"}`)}</Badge>
        <h3 id={titleId} className="text-sm font-semibold text-fg">
          {t(`admin.arena.queue.reasons.${reasonKey}`)}
        </h3>
        <span className="ml-auto text-xs text-fg-subtle">{formatDateTime(item.created_at, locale)}</span>
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
        {item.quiz_title ? <span>{t("admin.arena.queue.quiz", { title: item.quiz_title })}</span> : null}
        {item.owner_email ? <span className="[overflow-wrap:anywhere]">{t("admin.arena.queue.owner", { email: item.owner_email })}</span> : null}
        {item.join_code ? <span className="font-mono">{t("admin.arena.queue.session", { code: formatJoinCode(item.join_code) })}</span> : null}
        {item.position !== null ? <span>{t("admin.arena.queue.position", { position: item.position + 1 })}</span> : null}
      </p>
      {item.excerpt ? (
        <blockquote className="rounded-md border-l-2 border-line-strong bg-surface-muted px-3 py-2 font-serif text-sm leading-relaxed text-fg">
          <span className="sr-only">{t("admin.arena.queue.excerpt")}: </span>
          {item.excerpt}
        </blockquote>
      ) : null}
      {item.note ? (
        <p className="text-sm text-fg">
          <span className="font-medium text-fg-muted">{t("admin.arena.queue.note")}: </span>
          {item.note}
        </p>
      ) : null}
      {findings.length ? (
        <details className="text-sm">
          <summary className="focus-ring cursor-pointer rounded-sm text-fg-muted">{t("admin.arena.queue.findings", { count: findings.length })}</summary>
          <ul className="mt-2 flex flex-col gap-1 pl-4 text-xs text-fg">
            {findings.map((finding, index) => (
              <li key={`${finding.position}-${finding.field}-${index}`}>
                {t("admin.arena.queue.finding", { position: finding.position !== null ? finding.position + 1 : "—", field: finding.field, term: finding.term })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {item.status !== "open" && item.resolution ? (
        <p className="text-xs text-fg-muted">
          {t("admin.arena.queue.resolved", { action: t(`admin.arena.queue.actions.${item.resolution}`) })}
          {item.resolved_at ? ` ${t("admin.arena.queue.resolvedAt", { date: formatDateTime(item.resolved_at, locale) })}` : ""}
          {item.resolution_note ? ` · ${t("admin.arena.queue.resolutionNote", { note: item.resolution_note })}` : ""}
        </p>
      ) : null}
      {actions.length ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === "dismiss" ? "ghost" : action === "approve" ? "secondary" : "danger"}
              onClick={() => onAction(action)}
            >
              {t(`admin.arena.queue.actions.${action}`)}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
