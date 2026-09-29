"use client";

import { useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Panel, Section } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import {
  useAdminAssignIssueVersionMutation,
  useAdminIssuesQuery,
  useAdminUpdateIssueMutation
} from "@/lib/query/admin-hooks";

import { ISSUE_STATUSES } from "@/features/admin/types";
import { readAdminError } from "@/features/admin/utils/admin-errors";
import { issueStatusLabel } from "@/features/admin/utils/labels";

type PanelNotice = { tone: "neutral" | "warning" | "danger" | "success"; message: string };

const STATUS_ACTIONS = [
  ["triaged", "admin.issues.actions.triage"],
  ["fix_in_progress", "admin.issues.actions.fixing"],
  ["verified", "admin.issues.actions.verify"],
  ["released", "admin.issues.actions.release"],
  ["dismissed", "admin.issues.actions.dismiss"]
] as const;

export function AdminIssuesPanel({ canView, canTriage }: { canView: boolean; canTriage: boolean }) {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [panelNotice, setPanelNotice] = useState<PanelNotice | null>(null);
  const issuesQuery = useAdminIssuesQuery({ status: statusFilter || undefined }, { enabled: canView });
  const updateIssueMutation = useAdminUpdateIssueMutation();
  const assignVersionMutation = useAdminAssignIssueVersionMutation();
  const selectedIssue = issuesQuery.data?.find((item) => item.id === selectedIssueId) || null;

  function selectIssue(issueId: number) {
    const issue = issuesQuery.data?.find((item) => item.id === issueId) || null;
    setSelectedIssueId(issueId);
    setDraftNote(issue?.internal_note || "");
    setPanelNotice(null);
  }

  function reportError(error: unknown) {
    // Surface the backend `detail` (e.g. invalid status transition) instead of a generic message.
    setPanelNotice({ tone: "danger", message: readAdminError(error, t, "admin.issues.saveError") });
  }

  function updateStatus(issueId: number, nextStatus: string) {
    setPanelNotice(null);
    updateIssueMutation.mutate(
      { issueId, payload: { status: nextStatus } },
      {
        onSuccess: () => setPanelNotice({ tone: "success", message: t("admin.issues.saved") }),
        onError: reportError
      }
    );
  }

  function saveInternalNote() {
    if (!selectedIssue) {
      return;
    }
    setPanelNotice(null);
    updateIssueMutation.mutate(
      { issueId: selectedIssue.id, payload: { internal_note: draftNote } },
      {
        onSuccess: () => setPanelNotice({ tone: "success", message: t("admin.issues.saved") }),
        onError: reportError
      }
    );
  }

  function linkCurrentVersion() {
    if (!selectedIssue) {
      return;
    }
    setPanelNotice(null);
    assignVersionMutation.mutate(selectedIssue.id, {
      onSuccess: () => setPanelNotice({ tone: "success", message: t("admin.issues.versionLinked") }),
      onError: reportError
    });
  }

  return (
    <Section
      title={t("admin.issues.title")}
      description={t("admin.issues.subtitle")}
      actions={
        <div className="w-48">
          <Field label={t("admin.issues.statusFilter")} htmlFor="admin-issue-status-filter" hintMode="none">
            <Select id="admin-issue-status-filter" className="h-9" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">{t("common.filters.all")}</option>
              {ISSUE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {issueStatusLabel(t, status)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      }
    >
      {!canTriage ? <Alert tone="warning" title={t("admin.issues.title")} message={t("admin.issues.accessDenied")} /> : null}

      {!canView ? null : issuesQuery.isPending ? (
        <p className="text-sm text-fg-muted" role="status">
          {t("common.status.loading")}
        </p>
      ) : issuesQuery.isError ? (
        <QueryErrorBanner
          error={issuesQuery.error}
          title={t("admin.issues.loadError")}
          onRetry={() => void issuesQuery.refetch()}
          retrying={issuesQuery.isFetching}
        />
      ) : issuesQuery.data.length ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
          <ul className="flex flex-col gap-1" aria-label={t("admin.issues.listAriaLabel")}>
            {issuesQuery.data.map((issue) => {
              const selected = selectedIssueId === issue.id;
              return (
                <li key={issue.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectIssue(issue.id)}
                    className={cn(
                      "focus-ring flex w-full flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
                      selected ? "border-primary bg-primary-soft" : "border-transparent hover:bg-surface-muted"
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="nums font-mono text-xs text-fg-muted">#{issue.id}</span>
                      <span className="text-sm font-medium text-fg">{issue.category}</span>
                      <Badge>{issueStatusLabel(t, issue.status)}</Badge>
                    </span>
                    {issue.prompt_excerpt ? <span className="line-clamp-2 text-sm text-fg-muted">{issue.prompt_excerpt}</span> : null}
                    <span className="text-xs text-fg-subtle">
                      {issue.certification || "-"} · {issue.domain || "-"} · <span className="font-mono">{issue.question_id}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selectedIssue ? (
            <Panel className="lg:sticky lg:top-6">
              {panelNotice ? (
                <Alert
                  tone={panelNotice.tone}
                  title={t("admin.issues.detailTitle")}
                  message={panelNotice.message}
                  role={panelNotice.tone === "danger" ? "alert" : "status"}
                />
              ) : null}

              <div className="flex flex-col gap-2">
                <p className="text-xs text-fg-muted">
                  <span className="nums font-mono">#{selectedIssue.id}</span> · <span className="font-mono">{selectedIssue.question_id}</span>
                </p>
                <p className="font-serif text-[0.9375rem] leading-relaxed text-fg">{selectedIssue.message}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge>
                    {selectedIssue.resolved_version_id
                      ? t("admin.issues.versionTag", { id: selectedIssue.resolved_version_id })
                      : t("admin.issues.unassignedVersion")}
                  </Badge>
                  {selectedIssue.triaged_at ? <Badge tone="primary">{t("admin.issues.triagedTag")}</Badge> : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 border-t border-line pt-4">
                {STATUS_ACTIONS.map(([status, labelKey]) => (
                  <Button
                    key={status}
                    variant="secondary"
                    size="sm"
                    disabled={!canTriage || updateIssueMutation.isPending}
                    busy={updateIssueMutation.isPending && updateIssueMutation.variables?.payload.status === status}
                    onClick={() => updateStatus(selectedIssue.id, status)}
                  >
                    {t(labelKey)}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" disabled={!canTriage} busy={assignVersionMutation.isPending} onClick={linkCurrentVersion}>
                  {t("admin.issues.assignVersion")}
                </Button>
                <Link
                  href={`/admin/questions/${encodeURIComponent(selectedIssue.question_id)}`}
                  className="focus-ring rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t("admin.issues.openQuestion")}
                </Link>
              </div>

              <Field label={t("admin.issues.internalNote")} htmlFor="admin-issue-note">
                <Textarea id="admin-issue-note" rows={4} value={draftNote} disabled={!canTriage} onChange={(event) => setDraftNote(event.target.value)} />
              </Field>

              <div>
                <Button
                  size="sm"
                  disabled={!canTriage}
                  busy={updateIssueMutation.isPending && updateIssueMutation.variables?.payload.internal_note !== undefined}
                  onClick={saveInternalNote}
                >
                  {t("admin.issues.saveNote")}
                </Button>
              </div>
            </Panel>
          ) : (
            <EmptyState description={t("admin.issues.selectPrompt")} />
          )}
        </div>
      ) : (
        <EmptyState size="compact" description={t("admin.issues.empty")} />
      )}
    </Section>
  );
}
