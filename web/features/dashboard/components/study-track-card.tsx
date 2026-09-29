"use client";

import { Section } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatScore } from "@/lib/utils/format";
import type { StudyModule, StudyModuleStatus } from "@/types/api";

const KNOWN_STATUSES: readonly StudyModuleStatus[] = ["locked", "available", "in_progress", "completed"];

export function normalizeModuleStatus(value: StudyModule["status"]): StudyModuleStatus | null {
  return KNOWN_STATUSES.includes(value as StudyModuleStatus) ? (value as StudyModuleStatus) : null;
}

/** Titles of the prerequisites of `module` that are not completed yet (unknown codes shown as-is). */
export function pendingPrerequisiteTitles(module: StudyModule, modules: StudyModule[]): string[] {
  const byCode = new Map(modules.map((item) => [item.code, item]));
  return (module.prerequisite_codes ?? [])
    .map((code) => ({ code, prerequisite: byCode.get(code) }))
    .filter(({ prerequisite }) => normalizeModuleStatus(prerequisite?.status) !== "completed")
    .map(({ code, prerequisite }) => prerequisite?.title || code);
}

/**
 * Position marker in the product's answer-sheet language: filled = completed, half = in progress,
 * lock = locked, outline = available. Decorative: the status is always written next to it.
 */
function ModuleMarker({ status }: { status: StudyModuleStatus | null }) {
  const common = { width: 28, height: 28, viewBox: "0 0 28 28", "aria-hidden": true, focusable: false } as const;
  if (status === "completed") {
    return (
      <svg {...common} className="shrink-0 text-success">
        <circle cx="14" cy="14" r="12.5" fill="currentColor" />
        <path d="M9 14.4l3.4 3.4 6.6-7.3" fill="none" stroke="var(--color-surface)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "locked") {
    return (
      <svg {...common} className="shrink-0 text-fg-subtle">
        <circle cx="14" cy="14" r="12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
        <rect x="9.5" y="13" width="9" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11.5 13v-2a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg {...common} className={cn("shrink-0", status === "in_progress" ? "text-primary" : "text-line-strong")}>
      <circle cx="14" cy="14" r="12.5" fill="none" stroke="currentColor" strokeWidth="2" />
      {status === "in_progress" ? <path d="M14 1.5a12.5 12.5 0 0 1 0 25z" fill="currentColor" /> : null}
    </svg>
  );
}

interface StudyTrackCardProps {
  certification: string;
  modules: StudyModule[];
  recommendedModule?: Pick<StudyModule, "id" | "code"> | null;
}

export function StudyTrackCard({ certification, modules, recommendedModule }: StudyTrackCardProps) {
  const { t } = useI18n();
  const sorted = [...modules].sort((left, right) => left.position - right.position);
  const completedCount = sorted.filter((item) => normalizeModuleStatus(item.status) === "completed").length;
  const hasStatus = sorted.some((item) => normalizeModuleStatus(item.status) !== null);

  function isRecommended(module: StudyModule): boolean {
    if (!recommendedModule) {
      return false;
    }
    return module.id === recommendedModule.id || module.code === recommendedModule.code;
  }

  return (
    <Section
      title={t("dashboard.trackCard.title", { certification })}
      description={t("dashboard.trackCard.subtitle")}
      actions={
        hasStatus ? (
          <p className="nums text-[0.8125rem] text-fg-muted">{t("dashboard.trackCard.summary", { completed: completedCount, total: sorted.length })}</p>
        ) : null
      }
      data-testid="study-track-card"
    >
      <ol className="grid gap-x-8 lg:grid-cols-2" aria-label={t("dashboard.trackCard.listLabel", { certification })}>
        {sorted.map((module) => {
          const status = normalizeModuleStatus(module.status);
          const recommended = isRecommended(module);
          const pending = status === "completed" ? [] : pendingPrerequisiteTitles(module, sorted);
          const mastery = module.mastery_percent;
          const details = [
            mastery !== undefined
              ? typeof mastery === "number"
                ? t("dashboard.trackCard.mastery", { value: formatScore(mastery) })
                : t("dashboard.trackCard.masteryUnknown")
              : null,
            typeof module.attempted === "number" && module.attempted > 0 ? t("dashboard.trackCard.attempts", { count: module.attempted }) : null,
            module.domain
          ].filter(Boolean) as string[];
          return (
            <li
              key={module.id}
              aria-current={recommended ? "step" : undefined}
              data-testid={`track-module-${module.code}`}
              data-status={status ?? undefined}
              className={cn(
                "flex items-start gap-3 border-b border-line py-3",
                recommended && "-mx-3 rounded-md border-transparent bg-primary-soft px-3"
              )}
            >
              <ModuleMarker status={status} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn("text-sm font-medium", status === "locked" ? "text-fg-muted" : "text-fg")}>{t("dashboard.planCard.trackItem", { position: module.position, title: module.title })}
                  </span>
                  {recommended ? (
                    <span className="rounded-sm bg-primary px-1.5 py-0.5 text-[0.6875rem] font-semibold text-on-primary">
                      {t("dashboard.trackCard.recommended")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-fg-muted">
                  {status ? (
                    <span
                      className={cn(
                        "font-medium",
                        status === "completed" && "text-success",
                        status === "in_progress" && "text-primary",
                        status === "locked" && "text-fg-subtle"
                      )}
                    >
                      {t(`dashboard.trackCard.status.${status}`)}
                    </span>
                  ) : null}
                  {details.map((detail) => (
                    <span key={detail} className="inline-flex gap-2">
                      <span aria-hidden="true" className="text-fg-subtle">
                        ·
                      </span>
                      <span>{detail}</span>
                    </span>
                  ))}
                </p>
                {pending.length ? (
                  <p className="mt-1 text-xs text-fg-subtle">{t("dashboard.trackCard.pendingPrerequisites", { items: pending.join(", ") })}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
