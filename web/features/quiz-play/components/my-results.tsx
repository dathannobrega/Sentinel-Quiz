"use client";

import { useEffect, useState } from "react";

import { LqButton, LqError, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import { getMyResults, isTokenRejected } from "@/features/quiz-live/lib/live-fetch";
import { AccessForm } from "@/features/quiz-play/components/access-form";
import { useI18n } from "@/lib/i18n";
import type { LiveJoinResult, LiveMyResults } from "@/types/api/live";
import { cn } from "@/lib/utils/cn";

function formatAnswer(value: string[] | string | null): string | null {
  if (value === null) {
    return null;
  }
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * Personal results (GET /me/results with the participant Bearer token). A rejected token (expired
 * or replaced) asks for the name + return code when `access` is given (Incremento 4).
 */
export function MyResultsPanel({
  token,
  access
}: {
  token: string;
  access?: { sessionId: string | null; defaultName?: string; onTokenRefreshed?: (result: LiveJoinResult) => void };
}) {
  const { t, locale } = useI18n();
  const [activeToken, setActiveToken] = useState(token);
  const [data, setData] = useState<LiveMyResults | null>(null);
  const [error, setError] = useState(false);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getMyResults(activeToken, controller.signal)
      .then(setData)
      .catch((caught) => {
        if (!controller.signal.aborted) {
          if (isTokenRejected(caught) && access?.sessionId) {
            setNeedsAccess(true);
          } else {
            setError(true);
          }
        }
      });
    return () => controller.abort();
    // `access` is read at failure time only; re-running on its identity would refetch needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToken, attempt]);

  if (needsAccess && access?.sessionId) {
    return (
      <AccessForm
        variant="live"
        sessionId={access.sessionId}
        defaultName={access.defaultName}
        onAccess={(result) => {
          access.onTokenRefreshed?.(result);
          setNeedsAccess(false);
          setActiveToken(result.token);
        }}
      />
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <LqError>{t("quizPlay.results.error")}</LqError>
        <LqButton
          variant="secondary"
          onClick={() => {
            setError(false);
            setAttempt((value) => value + 1);
          }}
        >
          {t("quizPlay.room.retry")}
        </LqButton>
      </div>
    );
  }
  if (!data) {
    return (
      <p role="status" className="text-center text-lq-fg-muted">
        {t("quizPlay.results.loading")}
      </p>
    );
  }

  return (
    <section aria-labelledby="my-results-title" className="flex flex-col gap-3">
      <h2 id="my-results-title" className="font-lq text-xl font-extrabold text-lq-fg">
        {t("quizPlay.results.title")}
      </h2>
      <p className="text-sm text-lq-fg-muted">{t("quizPlay.results.summary", { correct: data.correct, total: data.total_scored })}</p>
      <ol className="flex flex-col gap-3">
        {data.items.map((item) => {
          const status =
            item.correct === null ? "notScored" : item.correct ? "correct" : item.fraction !== null && item.fraction > 0 ? "partial" : "incorrect";
          const badge = {
            correct: "bg-lq-success text-lq-on-success",
            incorrect: "bg-lq-danger text-lq-on-danger",
            partial: "bg-lq-warning text-lq-on-warning",
            notScored: "bg-lq-surface-2 text-lq-fg"
          }[status];
          const mark = { correct: "✓", incorrect: "✕", partial: "½", notScored: "·" }[status];
          const yours = formatAnswer(item.your_answer);
          const right = formatAnswer(item.correct_answer);
          return (
            <li key={item.position} className={cn(lqCardClass, "flex flex-col gap-2 p-4")}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-lq-mono text-xs text-lq-fg-muted">{t("quizPlay.results.item", { position: item.position + 1 })}</span>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold", badge)}>
                  <span aria-hidden="true">{mark}</span>
                  {t(`quizPlay.results.${status}`)}
                </span>
              </div>
              <p className="font-semibold text-lq-fg">{item.prompt}</p>
              <dl className="grid gap-1 text-sm">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-lq-fg-muted">{t("quizPlay.results.yourAnswer")}:</dt>
                  <dd className="text-lq-fg">{yours ?? t("quizPlay.results.noAnswer")}</dd>
                </div>
                {right ? (
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-lq-fg-muted">{t("quizPlay.results.correctAnswer")}:</dt>
                    <dd className="text-lq-fg">{right}</dd>
                  </div>
                ) : null}
              </dl>
              {item.points ? (
                <p className="font-lq-mono text-xs text-lq-fg-muted">{t("quizPlay.results.points", { points: new Intl.NumberFormat(locale).format(item.points) })}</p>
              ) : null}
              {item.explanation ? <p className="font-serif text-sm leading-relaxed text-lq-fg">{item.explanation}</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
