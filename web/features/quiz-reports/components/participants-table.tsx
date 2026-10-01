"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { RepeatSuspectBadge } from "@/features/quiz-challenge/components/challenge-widgets";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/ui/icons";
import {
  defaultSortDirection,
  formatDuration,
  formatInteger,
  formatPercent,
  pctValue,
  sortParticipants,
  type ParticipantSortKey,
  type SortDirection
} from "@/features/quiz-reports/lib/report-format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveReportParticipant } from "@/types/api";

const COLUMNS: Array<{ key: ParticipantSortKey; numeric: boolean }> = [
  { key: "rank", numeric: true },
  { key: "display_name", numeric: false },
  { key: "score", numeric: true },
  { key: "correct", numeric: true },
  { key: "score_pct", numeric: true },
  { key: "avg_ms", numeric: true }
];

export function ParticipantsTable({ participants, scoredItems }: { participants: LiveReportParticipant[]; scoredItems: number }) {
  const { t, locale } = useI18n();
  const [sortKey, setSortKey] = useState<ParticipantSortKey>("rank");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const rows = useMemo(() => sortParticipants(participants, sortKey, direction, locale), [participants, sortKey, direction, locale]);

  function sortBy(key: ParticipantSortKey) {
    if (key === sortKey) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(defaultSortDirection(key));
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface print:overflow-visible">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-[0.8125rem] text-fg-muted">
            {COLUMNS.map(({ key, numeric }) => {
              const active = key === sortKey;
              const label = t(`quizReports.participants.columns.${key}`);
              return (
                <th
                  key={key}
                  scope="col"
                  aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("px-3 py-2 font-medium", numeric ? "text-right" : "text-left")}
                >
                  <button
                    type="button"
                    onClick={() => sortBy(key)}
                    aria-label={t("quizReports.participants.sortBy", { column: label })}
                    className={cn(
                      "focus-ring inline-flex items-center gap-1 rounded-sm py-1 hover:text-fg print:pointer-events-none",
                      active && "text-fg",
                      numeric && "flex-row-reverse"
                    )}
                  >
                    {label}
                    <span aria-hidden="true" className={cn("inline-grid size-3.5 place-items-center", !active && "opacity-0")}>
                      {direction === "asc" ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.participant_id} className="border-b border-line last:border-b-0 hover:bg-surface-muted/40">
              <td className="nums px-3 py-2.5 text-right font-mono text-xs font-semibold text-fg-muted">
                {row.rank <= 3 ? <span className="mr-1" aria-hidden="true">{["🥇", "🥈", "🥉"][row.rank - 1]}</span> : null}
                {row.rank}
              </td>
              <td className="px-3 py-2.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{row.display_name}</span>
                  {row.is_guest ? <Badge tone="neutral">{t("quizReports.participants.guest")}</Badge> : null}
                  {row.repeat_suspect ? <RepeatSuspectBadge /> : null}
                </span>
              </td>
              <td className="nums px-3 py-2.5 text-right font-semibold text-fg">{formatInteger(row.score, locale)}</td>
              <td className="nums px-3 py-2.5 text-right text-fg">
                {t("quizReports.participants.correctOf", { correct: row.correct, answered: scoredItems })}
              </td>
              <td className="px-3 py-2.5 text-right">
                <span className="inline-flex items-center justify-end gap-2">
                  <span aria-hidden="true" className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted sm:block">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${pctValue(row.score_pct) ?? 0}%` }} />
                  </span>
                  <span className="nums w-12 text-fg">{formatPercent(pctValue(row.score_pct), locale)}</span>
                </span>
              </td>
              <td className="nums px-3 py-2.5 text-right text-fg-muted">{formatDuration(row.avg_ms, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
