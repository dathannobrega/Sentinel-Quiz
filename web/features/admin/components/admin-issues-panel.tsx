"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { StatusBanner } from "@/components/ui/status-banner";
import { useI18n } from "@/lib/i18n";
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
    <Card title={t("admin.issues.title")} subtitle={t("admin.issues.subtitle")}>
      {!canTriage ? <StatusBanner tone="warning" title={t("admin.issues.title")} message={t("admin.issues.accessDenied")} /> : null}
      <div className="sq-actions">
        <Field label={t("admin.issues.statusFilter")} htmlFor="admin-issue-status-filter" hintMode="none">
          <select
            id="admin-issue-status-filter"
            className="sq-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">{t("common.filters.all")}</option>
            {ISSUE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {issueStatusLabel(t, status)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!canView ? null : issuesQuery.isPending ? (
        <div className="sq-empty" role="status">
          {t("common.status.loading")}
        </div>
      ) : issuesQuery.isError ? (
        <QueryErrorBanner
          error={issuesQuery.error}
          title={t("admin.issues.loadError")}
          onRetry={() => void issuesQuery.refetch()}
          retrying={issuesQuery.isFetching}
        />
      ) : issuesQuery.data.length ? (
        <div className="sq-page-stack" style={{ marginTop: "var(--sq-space-4)" }}>
          <div className="sq-list" role="list" aria-label={t("admin.issues.listAriaLabel")}>
            {issuesQuery.data.map((issue) => (
              <div key={issue.id} role="listitem">
                <button
                  type="button"
                  className="sq-list-item"
                  aria-pressed={selectedIssueId === issue.id}
                  onClick={() => selectIssue(issue.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border:
                      selectedIssueId === issue.id
                        ? "1px solid rgba(14, 116, 144, 0.55)"
                        : "1px solid rgba(148, 163, 184, 0.18)"
                  }}
                >
                  <div className="sq-list-title">
                    #{issue.id} · {issue.category} · {issueStatusLabel(t, issue.status)}
                  </div>
                  <div className="sq-list-meta">
                    {issue.certification || "-"} · {issue.domain || "-"} · {issue.question_id}
                  </div>
                  {issue.prompt_excerpt ? <div className="sq-list-meta">{issue.prompt_excerpt}</div> : null}
                </button>
              </div>
            ))}
          </div>

          {selectedIssue ? (
            <div className="sq-surface-block">
              {panelNotice ? (
                <StatusBanner
                  tone={panelNotice.tone}
                  title={t("admin.issues.detailTitle")}
                  message={panelNotice.message}
                  role={panelNotice.tone === "danger" ? "alert" : "status"}
                />
              ) : null}

              <div className="sq-list-title">
                #{selectedIssue.id} · {selectedIssue.question_id}
              </div>
              <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-2)" }}>
                {selectedIssue.message}
              </div>
              <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-3)" }}>
                {selectedIssue.resolved_version_id ? (
                  <span className="sq-chip">{t("admin.issues.versionTag", { id: selectedIssue.resolved_version_id })}</span>
                ) : (
                  <span className="sq-chip">{t("admin.issues.unassignedVersion")}</span>
                )}
                {selectedIssue.triaged_at ? <span className="sq-chip">{t("admin.issues.triagedTag")}</span> : null}
              </div>

              <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
                {STATUS_ACTIONS.map(([status, labelKey]) => (
                  <Button
                    key={status}
                    variant="ghost"
                    size="sm"
                    disabled={!canTriage || updateIssueMutation.isPending}
                    busy={updateIssueMutation.isPending && updateIssueMutation.variables?.payload.status === status}
                    onClick={() => updateStatus(selectedIssue.id, status)}
                  >
                    {t(labelKey)}
                  </Button>
                ))}
              </div>

              <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canTriage}
                  busy={assignVersionMutation.isPending}
                  onClick={linkCurrentVersion}
                >
                  {t("admin.issues.assignVersion")}
                </Button>
                <Link href={`/admin/questions/${encodeURIComponent(selectedIssue.question_id)}`}>
                  {t("admin.issues.openQuestion")}
                </Link>
              </div>

              <div className="sq-gap-top-sm">
                <Field label={t("admin.issues.internalNote")} htmlFor="admin-issue-note">
                  <textarea
                    id="admin-issue-note"
                    className="sq-textarea"
                    rows={4}
                    value={draftNote}
                    disabled={!canTriage}
                    onChange={(event) => setDraftNote(event.target.value)}
                  />
                </Field>
              </div>

              <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
                <Button
                  size="sm"
                  disabled={!canTriage}
                  busy={updateIssueMutation.isPending && updateIssueMutation.variables?.payload.internal_note !== undefined}
                  onClick={saveInternalNote}
                >
                  {t("admin.issues.saveNote")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="sq-empty">{t("admin.issues.selectPrompt")}</div>
          )}
        </div>
      ) : (
        <div className="sq-empty">{t("admin.issues.empty")}</div>
      )}
    </Card>
  );
}
