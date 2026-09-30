"use client";

import { AlertIcon, ChevronRightIcon, CircleXIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveIssue } from "@/types/api";

interface IssueListProps {
  issues: LiveIssue[];
  tone: "danger" | "warning";
  title: string;
  description?: string;
  /** When given, issues tied to an item become buttons that select it. */
  onSelectItem?: (itemId: string) => void;
}

/** Server validation issues (publish 422 quiz_invalid / publish warnings), linked to their items. */
export function IssueList({ issues, tone, title, description, onSelectItem }: IssueListProps) {
  const { t } = useI18n();
  if (!issues.length) {
    return null;
  }
  const Icon = tone === "danger" ? CircleXIcon : AlertIcon;
  return (
    <section
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-2 rounded-md border p-4 text-sm",
        tone === "danger" ? "border-danger/30 bg-danger-soft" : "border-warning/30 bg-warning-soft"
      )}
    >
      <p className="flex items-center gap-2 font-semibold text-fg">
        <Icon className={tone === "danger" ? "text-danger" : "text-warning"} />
        {title}
      </p>
      {description ? <p className="text-fg-muted">{description}</p> : null}
      <ul className="flex flex-col gap-1">
        {issues.map((issue, index) => {
          const where =
            issue.position !== null ? t("quizBuilder.publish.goTo", { position: issue.position + 1 }) : t("quizBuilder.publish.quizLevel");
          const content = (
            <>
              <span className="shrink-0 font-medium text-fg">{where}</span>
              <span className="min-w-0 flex-1 text-fg">{issue.message || issue.code}</span>
            </>
          );
          return (
            <li key={`${issue.item_id ?? "quiz"}-${issue.field}-${issue.code}-${index}`}>
              {issue.item_id && onSelectItem ? (
                <button
                  type="button"
                  onClick={() => onSelectItem(issue.item_id as string)}
                  className="focus-ring flex w-full items-start gap-2 rounded-sm px-1 py-1 text-left hover:bg-surface/60"
                >
                  {content}
                  <ChevronRightIcon className="mt-1 shrink-0 text-fg-muted" />
                </button>
              ) : (
                <div className="flex items-start gap-2 px-1 py-1">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
