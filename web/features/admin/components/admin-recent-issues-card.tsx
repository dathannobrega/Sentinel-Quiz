"use client";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";
import type { QuestionIssue } from "@/types/api";

import { issueStatusLabel } from "@/features/admin/utils/labels";

export function AdminRecentIssuesCard({ issues }: { issues: QuestionIssue[] }) {
  const { t } = useI18n();

  return (
    <Section title={t("admin.issues.recentTitle")} description={t("admin.issues.recentSubtitle")}>
      {issues.length ? (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {issues.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="nums font-mono text-xs text-fg-muted">#{item.id}</span>
                <span className="text-sm font-medium text-fg">{item.category}</span>
                <Badge>{issueStatusLabel(t, item.status)}</Badge>
              </div>
              <p className="text-sm leading-relaxed text-fg">{item.message}</p>
              {item.prompt_excerpt ? <p className="line-clamp-1 text-xs text-fg-muted">{item.prompt_excerpt}</p> : null}
              <p className="text-xs text-fg-subtle">
                {item.certification || t("admin.insights.noDomain")} · {item.domain || t("admin.insights.noDomain")} ·{" "}
                <span className="font-mono">{item.question_id}</span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="compact" description={t("admin.issues.empty")} />
      )}
    </Section>
  );
}
