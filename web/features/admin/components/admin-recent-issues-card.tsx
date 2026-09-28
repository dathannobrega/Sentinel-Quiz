"use client";

import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import type { QuestionIssue } from "@/types/api";

import { issueStatusLabel } from "@/features/admin/utils/labels";

export function AdminRecentIssuesCard({ issues }: { issues: QuestionIssue[] }) {
  const { t } = useI18n();

  return (
    <Card title={t("admin.issues.recentTitle")} subtitle={t("admin.issues.recentSubtitle")}>
      {issues.length ? (
        <div className="sq-list">
          {issues.map((item) => (
            <div key={item.id} className="sq-list-item">
              <div className="sq-list-title">
                #{item.id} · {item.category} · {issueStatusLabel(t, item.status)}
              </div>
              <div className="sq-list-meta">
                {item.certification || t("admin.insights.noDomain")} · {item.domain || t("admin.insights.noDomain")} ·{" "}
                {item.question_id}
              </div>
              {item.prompt_excerpt ? <div className="sq-list-meta">{item.prompt_excerpt}</div> : null}
              <div className="sq-list-meta">{item.message}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sq-empty">{t("admin.issues.empty")}</div>
      )}
    </Card>
  );
}
