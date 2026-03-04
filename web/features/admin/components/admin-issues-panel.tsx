"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { StatusBanner } from "@/components/ui/status-banner";
import { useI18n } from "@/lib/i18n";
import { useAdminAssignIssueVersionMutation, useAdminIssuesQuery, useAdminUpdateIssueMutation, useCurrentUserQuery } from "@/lib/query/hooks";

export function AdminIssuesPanel() {
  const { t } = useI18n();
  const currentUserQuery = useCurrentUserQuery();
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [panelNotice, setPanelNotice] = useState<{ tone: "neutral" | "warning" | "danger" | "success"; message: string } | null>(null);
  const issuesQuery = useAdminIssuesQuery({ status: statusFilter || undefined });
  const updateIssueMutation = useAdminUpdateIssueMutation();
  const assignVersionMutation = useAdminAssignIssueVersionMutation();
  const canTriage = ["reviewer", "admin"].includes(String(currentUserQuery.data?.role || ""));
  const selectedIssue = issuesQuery.data?.find((item) => item.id === selectedIssueId) || null;

  function selectIssue(issueId: number) {
    const issue = issuesQuery.data?.find((item) => item.id === issueId) || null;
    setSelectedIssueId(issueId);
    setDraftNote(issue?.internal_note || "");
    setPanelNotice(null);
  }

  async function updateStatus(issueId: number, nextStatus: string) {
    setPanelNotice(null);
    try {
      await updateIssueMutation.mutateAsync({
        issueId,
        payload: { status: nextStatus },
      });
      setPanelNotice({ tone: "success", message: t("admin.issues.saved") });
    } catch {
      setPanelNotice({ tone: "danger", message: t("admin.issues.saveError") });
    }
  }

  async function saveInternalNote() {
    if (!selectedIssue) {
      return;
    }
    setPanelNotice(null);
    try {
      await updateIssueMutation.mutateAsync({
        issueId: selectedIssue.id,
        payload: { internal_note: draftNote },
      });
      setPanelNotice({ tone: "success", message: t("admin.issues.saved") });
    } catch {
      setPanelNotice({ tone: "danger", message: t("admin.issues.saveError") });
    }
  }

  async function linkCurrentVersion() {
    if (!selectedIssue) {
      return;
    }
    setPanelNotice(null);
    try {
      await assignVersionMutation.mutateAsync(selectedIssue.id);
      setPanelNotice({ tone: "success", message: t("admin.issues.versionLinked") });
    } catch {
      setPanelNotice({ tone: "danger", message: t("admin.issues.saveError") });
    }
  }

  return (
    <Card title={t("admin.issues.title")} subtitle={t("admin.issues.subtitle")}>
      {!canTriage ? (
        <StatusBanner tone="warning" title={t("admin.issues.title")} message={t("admin.issues.accessDenied")} />
      ) : null}
      <div className="sq-actions">
        <select className="sq-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">{t("common.filters.all")}</option>
          {["open", "triaged", "fix_in_progress", "verified", "released", "dismissed"].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      {issuesQuery.isLoading ? (
        <div className="sq-empty">{t("common.status.loading")}</div>
      ) : issuesQuery.isError ? (
        <div className="sq-empty">{t("admin.issues.loadError")}</div>
      ) : issuesQuery.data?.length ? (
        <div className="sq-page-stack" style={{ marginTop: "var(--sq-space-4)" }}>
          <div className="sq-list">
            {issuesQuery.data.map((issue) => (
              <button
                key={issue.id}
                type="button"
                className="sq-list-item"
                onClick={() => selectIssue(issue.id)}
                style={{
                  textAlign: "left",
                  border:
                    selectedIssueId === issue.id
                      ? "1px solid rgba(14, 116, 144, 0.55)"
                      : "1px solid rgba(148, 163, 184, 0.18)",
                }}
              >
                <div className="sq-list-title">
                  #{issue.id} · {issue.category} · {issue.status}
                </div>
                <div className="sq-list-meta">
                  {issue.certification || "-"} · {issue.domain || "-"} · {issue.question_id}
                </div>
                {issue.prompt_excerpt ? <div className="sq-list-meta">{issue.prompt_excerpt}</div> : null}
              </button>
            ))}
          </div>

          {selectedIssue ? (
            <div className="sq-surface-block">
              {panelNotice ? (
                <StatusBanner
                  tone={panelNotice.tone}
                  title={t("admin.issues.detailTitle")}
                  message={panelNotice.message}
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
                {[
                  ["triaged", t("admin.issues.actions.triage")],
                  ["fix_in_progress", t("admin.issues.actions.fixing")],
                  ["verified", t("admin.issues.actions.verify")],
                  ["released", t("admin.issues.actions.release")],
                  ["dismissed", t("admin.issues.actions.dismiss")],
                ].map(([status, label]) => (
                  <Button
                    key={status}
                    variant="ghost"
                    size="sm"
                    disabled={!canTriage}
                    busy={updateIssueMutation.isPending}
                    onClick={() => void updateStatus(selectedIssue.id, status)}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
                <Button variant="secondary" size="sm" disabled={!canTriage} busy={assignVersionMutation.isPending} onClick={() => void linkCurrentVersion()}>
                  {t("admin.issues.assignVersion")}
                </Button>
                <Link href={`/admin/questions/${encodeURIComponent(selectedIssue.question_id)}`}>{t("admin.issues.openQuestion")}</Link>
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
                <Button size="sm" disabled={!canTriage} busy={updateIssueMutation.isPending} onClick={() => void saveInternalNote()}>
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
