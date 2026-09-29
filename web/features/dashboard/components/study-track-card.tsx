"use client";

import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
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

/** Status glyphs are decorative: the status is always spelled out next to them (not color only). */
function StatusIcon({ status }: { status: StudyModuleStatus }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false
  };
  switch (status) {
    case "completed":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5 8.2l2 2 4-4.4" />
        </svg>
      );
    case "in_progress":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
        </svg>
      );
    case "locked":
      return (
        <svg {...common}>
          <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" />
        </svg>
      );
  }
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
    <Card
      title={t("dashboard.trackCard.title", { certification })}
      subtitle={t("dashboard.trackCard.subtitle")}
      data-testid="study-track-card"
    >
      {hasStatus ? (
        <p className="sq-list-meta" style={{ marginBottom: "var(--sq-space-3)" }}>
          {t("dashboard.trackCard.summary", { completed: completedCount, total: sorted.length })}
        </p>
      ) : null}
      <ol className="sq-track-list" aria-label={t("dashboard.trackCard.listLabel", { certification })}>
        {sorted.map((module) => {
          const status = normalizeModuleStatus(module.status);
          const recommended = isRecommended(module);
          const pending = status === "completed" ? [] : pendingPrerequisiteTitles(module, sorted);
          const mastery = module.mastery_percent;
          return (
            <li
              key={module.id}
              className={`sq-track-item${recommended ? " sq-track-item--recommended" : ""}`}
              aria-current={recommended ? "step" : undefined}
              data-testid={`track-module-${module.code}`}
              data-status={status ?? undefined}
            >
              <div className="sq-track-item__head">
                <span className="sq-list-title">
                  {t("dashboard.planCard.trackItem", { position: module.position, title: module.title })}
                </span>
                {recommended ? (
                  <span className="sq-track-badge sq-track-badge--recommended">{t("dashboard.trackCard.recommended")}</span>
                ) : null}
              </div>
              <div className="sq-chip-row">
                {status ? (
                  <span className={`sq-track-status sq-track-status--${status}`}>
                    <StatusIcon status={status} />
                    {t(`dashboard.trackCard.status.${status}`)}
                  </span>
                ) : null}
                {mastery !== undefined ? (
                  <span className="sq-chip">
                    {typeof mastery === "number"
                      ? t("dashboard.trackCard.mastery", { value: formatScore(mastery) })
                      : t("dashboard.trackCard.masteryUnknown")}
                  </span>
                ) : null}
                {typeof module.attempted === "number" && module.attempted > 0 ? (
                  <span className="sq-chip">{t("dashboard.trackCard.attempts", { count: module.attempted })}</span>
                ) : null}
                {module.domain ? <span className="sq-chip">{module.domain}</span> : null}
              </div>
              {pending.length ? (
                <p className="sq-list-meta">
                  {t("dashboard.trackCard.pendingPrerequisites", { items: pending.join(", ") })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
