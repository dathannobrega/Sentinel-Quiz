"use client";

import { useId } from "react";

import { FlagIcon } from "@/components/ui/icons";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";
import type { ExamReviewScreen } from "@/types/api";

interface ExamNavigatorProps {
  reviewScreen: ExamReviewScreen | null;
  answeredCount: number;
  totalQuestions: number;
  currentPosition: number;
  isLoading: boolean;
  disabled?: boolean;
  minimal?: boolean;
  onJump: (position: number) => void;
  t: Translate;
}

/**
 * The answer sheet: one bubble per question. Filled = answered, outline = pending, flag = marked,
 * ring = current. Every state is also in the button's accessible name.
 */
export function ExamNavigator({
  reviewScreen,
  answeredCount,
  totalQuestions,
  currentPosition,
  isLoading,
  disabled = false,
  minimal = false,
  onJump,
  t
}: ExamNavigatorProps) {
  const answered = reviewScreen?.answered_count ?? answeredCount;
  const total = reviewScreen?.total_questions ?? totalQuestions;
  const titleId = useId();

  return (
    <section className="flex flex-col gap-4" aria-labelledby={titleId}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-sm font-semibold text-fg">
            {minimal ? t("runner.navigator.title") : t("runner.navigator.examTitle")}
          </h2>
          <p className="text-xs text-fg-muted">{minimal ? t("runner.navigator.minimalSubtitle") : t("runner.navigator.examSubtitle")}</p>
        </div>
        <span className="nums font-mono text-sm text-fg-muted">{`${answered}/${total}`}</span>
      </div>

      {reviewScreen ? (
        <>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-full border-[1.5px] border-line-strong" />
              {t("runner.navigator.pending", { count: reviewScreen.unanswered_count })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FlagIcon size={12} className="text-warning" />
              {t("runner.navigator.flagged", { count: reviewScreen.marked_for_review_count })}
            </span>
          </p>
          <nav aria-label={t("runner.navigator.listLabel")}>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5">
              {reviewScreen.items.map((item) => {
                const isCurrent = item.position === currentPosition;
                const isPbq = item.format === "pbq";
                const labelParts = [
                  t("runner.navigator.itemLabel", { number: item.position + 1 }),
                  ...(isPbq ? [t("pbq.formatLabel")] : []),
                  item.answered ? t("runner.navigator.itemAnswered") : t("runner.navigator.itemUnanswered")
                ];
                if (item.marked_for_review) {
                  labelParts.push(t("runner.navigator.itemMarked"));
                }
                if (isCurrent) {
                  labelParts.push(t("runner.navigator.itemCurrent"));
                }
                return (
                  <li key={`${item.question_id}-${item.position}`} className="flex justify-center">
                    <button
                      type="button"
                      aria-current={isCurrent ? "true" : undefined}
                      aria-label={labelParts.join(", ")}
                      disabled={disabled}
                      onClick={() => onJump(item.position)}
                      className={cn(
                        "focus-ring nums relative grid size-10 place-items-center rounded-full border-2 font-mono text-[0.8125rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        item.answered ? "border-fg bg-fg text-canvas" : "border-line-strong text-fg-muted hover:border-fg-subtle hover:text-fg",
                        isCurrent && "ring-2 ring-primary ring-offset-2 ring-offset-surface"
                      )}
                    >
                      <span aria-hidden="true">{item.position + 1}</span>
                      {item.marked_for_review ? (
                        <span aria-hidden="true" className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-warning text-surface">
                          <FlagIcon size={9} strokeWidth={2.4} />
                        </span>
                      ) : null}
                      {isPbq ? (
                        <span
                          aria-hidden="true"
                          className="absolute -bottom-1.5 rounded-sm bg-surface-raised px-1 font-sans text-[0.5625rem] leading-3 font-semibold text-fg-muted shadow-raised"
                        >
                          {t("pbq.badge")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      ) : (
        <p className="text-sm text-fg-muted">{isLoading ? t("runner.navigator.loading") : t("runner.navigator.empty")}</p>
      )}
    </section>
  );
}
