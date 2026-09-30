"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { eraseMyData, getMyData, isTokenRejected } from "@/features/quiz-live/lib/live-fetch";
import { AccessForm } from "@/features/quiz-play/components/access-form";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { LiveJoinResult, LiveMyData, LiveMyDataAnswer } from "@/types/api/live";

type Load = { kind: "loading" } | { kind: "ready"; data: LiveMyData } | { kind: "error" } | { kind: "access" };

function answerText(answer: LiveMyDataAnswer): string | null {
  const response = answer.response ?? {};
  if (typeof response.text === "string" && response.text) {
    return `“${response.text}”`;
  }
  if (Array.isArray(response.choice) && response.choice.length) {
    return `${response.choice.length}×`;
  }
  return null;
}

/**
 * RF-650 / RF-606: what the room keeps about the participant, and "delete my data". The token
 * may be missing or rejected (expired, replaced): the view then asks for the return code and
 * continues with the fresh token (`onTokenRefreshed` lets the caller keep it).
 */
export function MyDataView({
  token,
  sessionId,
  defaultName,
  onTokenRefreshed,
  onErased
}: {
  token: string | null;
  sessionId: string | null;
  defaultName?: string;
  onTokenRefreshed?: (result: LiveJoinResult) => void;
  onErased: () => void;
}) {
  const { t, locale } = useI18n();
  const [activeToken, setActiveToken] = useState<string | null>(token);
  const [attempt, setAttempt] = useState(0);
  // Results are tagged with the request they answer, so a new token/attempt reads as "loading".
  const requestKey = activeToken ? `${activeToken}#${attempt}` : null;
  const [result, setResult] = useState<{ key: string; value: Load } | null>(null);
  const load: Load = !requestKey ? { kind: "access" } : result?.key === requestKey ? result.value : { kind: "loading" };
  const [confirmErase, setConfirmErase] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeToken) {
      return undefined;
    }
    const key = `${activeToken}#${attempt}`;
    const controller = new AbortController();
    getMyData(activeToken, controller.signal)
      .then((data) => setResult({ key, value: { kind: "ready", data } }))
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setResult({ key, value: isTokenRejected(error) ? { kind: "access" } : { kind: "error" } });
      });
    return () => controller.abort();
  }, [activeToken, attempt]);

  const onAccess = useCallback(
    (result: LiveJoinResult) => {
      onTokenRefreshed?.(result);
      setActiveToken(result.token);
    },
    [onTokenRefreshed]
  );

  async function erase() {
    if (!activeToken) {
      return;
    }
    setErasing(true);
    setEraseError(null);
    try {
      await eraseMyData(activeToken);
      setConfirmErase(false);
      onErased();
    } catch (error) {
      setConfirmErase(false);
      if (isTokenRejected(error) && requestKey) {
        setResult({ key: requestKey, value: { kind: "access" } });
      } else {
        setEraseError(t("quizPlay.myData.eraseError"));
      }
    } finally {
      setErasing(false);
    }
  }

  if (load.kind === "access") {
    return sessionId ? (
      <AccessForm sessionId={sessionId} defaultName={defaultName} onAccess={onAccess} />
    ) : (
      <p className="text-sm text-fg-muted">{t("quizPlay.myData.noParticipation")}</p>
    );
  }
  if (load.kind === "loading") {
    return (
      <p role="status" className="text-sm text-fg-muted">
        {t("quizPlay.myData.loading")}
      </p>
    );
  }
  if (load.kind === "error") {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="danger" role="alert" message={t("quizPlay.myData.error")} />
        <Button variant="secondary" className="self-start" onClick={() => setAttempt((value) => value + 1)}>
          {t("quizPlay.myData.retry")}
        </Button>
      </div>
    );
  }

  const { participant, session, answers } = load.data;
  const none = t("quizPlay.myData.none");
  const rows: Array<[string, string]> = [
    [t("quizPlay.myData.name"), participant.display_name],
    [t("quizPlay.myData.session"), session.title || none],
    [t("quizPlay.myData.joined"), participant.joined_at ? formatDateTime(participant.joined_at, locale) : none],
    [t("quizPlay.myData.lastSeen"), participant.last_seen_at ? formatDateTime(participant.last_seen_at, locale) : none],
    [t("quizPlay.myData.consent"), participant.consent_version ?? none],
    [t("quizPlay.myData.account"), participant.linked_account ? t("quizPlay.myData.accountYes") : t("quizPlay.myData.accountNo")],
    [t("quizPlay.myData.score"), participant.final_score !== null ? new Intl.NumberFormat(locale).format(participant.final_score) : none],
    [t("quizPlay.myData.rank"), participant.final_rank !== null ? String(participant.final_rank) : none]
  ];

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="my-data-profile" className="flex flex-col gap-3">
        <h3 id="my-data-profile" className="text-sm font-semibold text-fg">
          {t("quizPlay.myData.profile")}
          {session.status ? <span className="ml-2 text-xs font-normal text-fg-muted">· {t(`quizPlay.myData.sessionStatus.${session.status}`)}</span> : null}
        </h3>
        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="min-w-0 break-words text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="my-data-answers" className="flex flex-col gap-3">
        <h3 id="my-data-answers" className="text-sm font-semibold text-fg">
          {t("quizPlay.myData.answersTitle", { count: answers.length })}
        </h3>
        {answers.length ? (
          <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
            {answers.map((answer, index) => {
              const verdict = answer.correct === null ? "answerNotScored" : answer.correct ? "answerCorrect" : "answerIncorrect";
              const given = answerText(answer);
              return (
                <li key={`${answer.position}-${index}`} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-fg-muted">{t("quizPlay.myData.answerItem", { position: answer.position + 1 })}</span>
                    <span
                      className={cn(
                        "rounded-sm px-1.5 text-xs font-medium",
                        answer.correct === null ? "bg-surface-muted text-fg-muted" : answer.correct ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                      )}
                    >
                      {t(`quizPlay.myData.${verdict}`)}
                    </span>
                  </div>
                  {answer.prompt ? <p className="line-clamp-2 text-fg">{answer.prompt}</p> : null}
                  <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                    {given ? <span className="break-all">{given}</span> : null}
                    {typeof answer.points === "number" ? <span>{t("quizPlay.myData.answerPoints", { points: answer.points })}</span> : null}
                    {answer.received_at ? <span>{formatDateTime(answer.received_at, locale)}</span> : null}
                  </p>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-fg-muted">{t("quizPlay.myData.noAnswers")}</p>
        )}
        <p className="text-xs leading-relaxed text-fg-muted">{t("quizPlay.myData.retention")}</p>
      </section>

      <section aria-labelledby="my-data-erase" className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger-soft/40 p-4">
        <h3 id="my-data-erase" className="text-sm font-semibold text-fg">
          {t("quizPlay.myData.eraseTitle")}
        </h3>
        <p className="text-sm leading-relaxed text-fg-muted">{t("quizPlay.myData.eraseText")}</p>
        {eraseError ? <Alert tone="danger" role="alert" message={eraseError} /> : null}
        <Button variant="danger" className="self-start" onClick={() => setConfirmErase(true)}>
          {t("quizPlay.myData.eraseAction")}
        </Button>
      </section>

      <ConfirmDialog
        open={confirmErase}
        busy={erasing}
        tone="danger"
        title={t("quizPlay.myData.eraseTitle")}
        message={t("quizPlay.myData.eraseText")}
        confirmLabel={erasing ? t("quizPlay.myData.erasing") : t("quizPlay.myData.eraseConfirm")}
        cancelLabel={t("quizPlay.myData.eraseCancel")}
        onCancel={() => setConfirmErase(false)}
        onConfirm={() => void erase()}
      />
    </div>
  );
}

/** "Meus dados" as a side sheet (full width on phones). */
export function MyDataDialog({
  open,
  onClose,
  intro,
  ...viewProps
}: {
  open: boolean;
  onClose: () => void;
  /** Short explanation shown above the data (e.g. from the join consent). */
  intro?: string;
  token: string | null;
  sessionId: string | null;
  defaultName?: string;
  onTokenRefreshed?: (result: LiveJoinResult) => void;
  onErased: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} placement="right" title={t("quizPlay.myData.title")} description={t("quizPlay.myData.subtitle")} className="w-[min(28rem,100vw)]">
      {/* Mounted only while open: every opening reloads the data (it changes during the session). */}
      {open ? (
        <div className="flex flex-col gap-5">
          {intro ? <p className="text-sm leading-relaxed text-fg-muted">{intro}</p> : null}
          <MyDataView {...viewProps} />
        </div>
      ) : null}
    </Dialog>
  );
}
