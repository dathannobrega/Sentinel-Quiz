"use client";

import { Badge } from "@/components/ui/badge";
import { AlertIcon, BookmarkIcon, CircleCheckIcon, ClockIcon, NoteIcon } from "@/components/ui/icons";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { ReviewQueueEntry } from "@/types/api";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function describeQueueState(item: ReviewQueueEntry, t: Translate): string {
  if (item.is_overdue) {
    return t("review.queueState.overdue", { days: item.overdue_days });
  }
  if (item.state === "due_now") {
    return t("review.queueState.dueToday");
  }
  if (item.state === "at_risk") {
    return t("review.queueState.atRisk");
  }
  if (item.state === "mastered") {
    return t("review.queueState.mastered");
  }
  return item.due_at ? t("review.queueState.scheduledFor", { date: formatDateTime(item.due_at) }) : t("review.queueState.scheduled");
}

/** Urgency is carried by icon + text; color only reinforces it. */
function QueueState({ item, t }: { item: ReviewQueueEntry; t: Translate }) {
  const label = describeQueueState(item, t);
  let tone = "text-fg-muted";
  let Icon = ClockIcon;
  if (item.is_overdue) {
    tone = "text-danger";
    Icon = AlertIcon;
  } else if (item.state === "due_now") {
    tone = "text-warning";
  } else if (item.state === "at_risk") {
    tone = "text-warning";
    Icon = AlertIcon;
  } else if (item.state === "mastered") {
    tone = "text-success";
    Icon = CircleCheckIcon;
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", tone)}>
      <Icon size={14} />
      {label}
    </span>
  );
}

interface ReviewQueueListProps {
  items: ReviewQueueEntry[];
  t: Translate;
  limit?: number;
  busy?: boolean;
}

/** Spaced-repetition queue as hairline-separated rows: prompt first, state and context below. */
export function ReviewQueueList({ items, t, limit, busy = false }: ReviewQueueListProps) {
  const visible = typeof limit === "number" ? items.slice(0, limit) : items;
  return (
    <ul className="divide-y divide-line border-y border-line" aria-busy={busy || undefined}>
      {visible.map((item) => (
        <li key={item.question_id} className="flex flex-col gap-1.5 py-3.5">
          <p className="line-clamp-2 font-serif text-[0.9375rem] leading-relaxed text-fg">{item.prompt}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-fg-muted">
            <QueueState item={item} t={t} />
            {[item.certification, item.domain].filter(Boolean).length ? (
              <span>{[item.certification, item.domain].filter(Boolean).join(" · ")}</span>
            ) : null}
            {item.bookmarked ? (
              <Badge>
                <BookmarkIcon />
                {t("common.status.marked")}
              </Badge>
            ) : null}
            {item.has_note ? (
              <Badge>
                <NoteIcon />
                {t("common.status.withNote")}
              </Badge>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
