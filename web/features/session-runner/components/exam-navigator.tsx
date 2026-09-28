"use client";

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

  return (
    <div className="sq-runner-utility">
      <div className="sq-runner-utility__head">
        <div>
          <div className="sq-list-title">{minimal ? t("runner.navigator.title") : t("runner.navigator.examTitle")}</div>
          <div className="sq-list-meta">
            {minimal ? t("runner.navigator.minimalSubtitle") : t("runner.navigator.examSubtitle")}
          </div>
        </div>
        <span className="sq-chip">{`${answered}/${total}`}</span>
      </div>

      {reviewScreen ? (
        <>
          <div className="sq-chip-row sq-gap-top-sm">
            <span className="sq-chip">{t("runner.navigator.pending", { count: reviewScreen.unanswered_count })}</span>
            <span className="sq-chip">{t("runner.navigator.flagged", { count: reviewScreen.marked_for_review_count })}</span>
          </div>
          <nav aria-label={t("runner.navigator.listLabel")}>
            <ul className="sq-chip-row sq-gap-top-sm sq-runner-navigator__list">
              {reviewScreen.items.map((item) => {
                const isCurrent = item.position === currentPosition;
                const labelParts = [
                  t("runner.navigator.itemLabel", { number: item.position + 1 }),
                  item.answered ? t("runner.navigator.itemAnswered") : t("runner.navigator.itemUnanswered")
                ];
                if (item.marked_for_review) {
                  labelParts.push(t("runner.navigator.itemMarked"));
                }
                if (isCurrent) {
                  labelParts.push(t("runner.navigator.itemCurrent"));
                }
                return (
                  <li key={`${item.question_id}-${item.position}`}>
                    <button
                      type="button"
                      className={cn(
                        "sq-chip sq-navigator-item",
                        isCurrent && "sq-navigator-item--current",
                        item.answered && "sq-navigator-item--answered",
                        item.marked_for_review && "sq-navigator-item--marked"
                      )}
                      aria-current={isCurrent ? "true" : undefined}
                      aria-label={labelParts.join(", ")}
                      disabled={disabled}
                      onClick={() => onJump(item.position)}
                    >
                      {item.position + 1}
                      {item.marked_for_review ? <span aria-hidden="true"> ⚑</span> : null}
                      {item.answered ? <span aria-hidden="true"> ✓</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      ) : (
        <div className="sq-list-meta sq-gap-top-sm">
          {isLoading ? t("runner.navigator.loading") : t("runner.navigator.empty")}
        </div>
      )}
    </div>
  );
}
