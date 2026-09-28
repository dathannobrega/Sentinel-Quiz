"use client";

import { memo, useEffect, useRef, useState } from "react";

import { useExamCountdown, type CountdownInput } from "@/features/session-runner/hooks/use-exam-countdown";
import { formatRemainingTime, type Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";

interface ExamTimerProps extends CountdownInput {
  emphasized?: boolean;
  onExpire: () => void;
  t: Translate;
}

const ANNOUNCE_THRESHOLDS: Array<{ seconds: number; key: string }> = [
  { seconds: 300, key: "runner.timer.fiveMinutes" },
  { seconds: 60, key: "runner.timer.oneMinute" },
  { seconds: 0, key: "runner.timer.expired" }
];

/**
 * Self-contained countdown: only this chip re-renders every second. The visible time is not a live
 * region (it would spam screen readers); a separate polite region announces 5 min / 1 min / 0.
 */
export const ExamTimer = memo(function ExamTimer({ emphasized = false, onExpire, t, ...countdown }: ExamTimerProps) {
  const remaining = useExamCountdown(countdown, onExpire);
  const [announcement, setAnnouncement] = useState("");
  const lastAnnounced = useRef<number | null>(null);

  useEffect(() => {
    if (remaining === null || countdown.paused) {
      return;
    }
    const threshold = ANNOUNCE_THRESHOLDS.find(
      (item) => remaining <= item.seconds && remaining > item.seconds - 2 && lastAnnounced.current !== item.seconds
    );
    if (threshold) {
      lastAnnounced.current = threshold.seconds;
      setAnnouncement(t(threshold.key));
    }
  }, [countdown.paused, remaining, t]);

  const time = formatRemainingTime(remaining);
  const label = countdown.paused ? t("runner.timer.pausedLabel", { time }) : t("runner.timer.label", { time });

  return (
    <>
      <span
        className={cn("sq-chip", emphasized && "sq-runner-timer--emphasized")}
        role="timer"
        aria-live="off"
        aria-label={label}
      >
        <span aria-hidden="true">
          {countdown.paused ? t("runner.questionCard.paused") : t("runner.questionCard.time")} {time}
        </span>
      </span>
      <span className="sq-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
});
