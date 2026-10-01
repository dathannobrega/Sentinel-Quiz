"use client";

import { useEffect, useRef } from "react";

import { Avatar } from "@/components/quiz-kit/avatar";
import { LqButton } from "@/features/quiz-live/components/lq-ui";
import type { WaitingTicket } from "@/features/quiz-live/lib/live-fetch";
import { useWaitingRoom, type WaitingEnd } from "@/features/quiz-live/lib/use-waiting-room";
import { useI18n } from "@/lib/i18n";
import type { LiveJoinResult } from "@/types/api/live";

/**
 * Waiting room on the phone (Incremento 7 §7): after a 202 the person sees their name and avatar,
 * why they wait (the host's approval, or their place in the full room's queue) and "Sair da fila".
 * The page polls with the wait token (see `useWaitingRoom`); once admitted, `onAdmitted` gets the
 * join result and the flow continues exactly like a normal join.
 *
 * Screen readers hear the reason once, then only when the place in line changes (the total
 * waiting changes on every poll and is not announced).
 */
export function WaitingRoomScreen({
  code,
  ticket,
  resumed = false,
  onAdmitted,
  onLeft,
  onRetry
}: {
  code: string;
  ticket: WaitingTicket;
  /** The ticket came from this tab's storage (reload): poll right away. */
  resumed?: boolean;
  onAdmitted: (join: LiveJoinResult) => void;
  /** "Sair da fila" done: back to the join form. */
  onLeft: () => void;
  /** "Tentar de novo" after the wait ended. */
  onRetry: () => void;
}) {
  const { t, locale } = useI18n();
  const wait = useWaitingRoom({ code, ticket, immediate: resumed, onAdmitted });

  if (wait.end) {
    return <WaitingEnded end={wait.end} onRetry={onRetry} />;
  }

  const current = wait.ticket;
  const capacity = current.reason === "capacity";
  const format = new Intl.NumberFormat(locale);
  const announcement = capacity
    ? current.position !== null
      ? t("quizPlay.waiting.announcePosition", { position: format.format(current.position) })
      : ""
    : t("quizPlay.waiting.announceApproval");

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <p className="font-lq-mono text-xs font-medium tracking-[0.2em] text-lq-fg-muted uppercase">{t("quizPlay.waiting.title")}</p>
      <div className="relative grid place-items-center">
        <span aria-hidden="true" className="lq-waiting-ring absolute inset-0 rounded-full border-2 border-lq-accent" />
        <span aria-hidden="true" className="absolute -inset-2 rounded-full border border-lq-line" />
        <Avatar seed={current.avatarSeed} size={80} className="relative" />
      </div>
      <p className="font-lq text-xl font-bold break-words text-lq-fg">{current.displayName}</p>

      {capacity ? (
        <div className="flex flex-col items-center gap-1">
          <h2 className="font-lq text-2xl font-extrabold text-balance text-lq-fg">{t("quizPlay.waiting.capacityTitle")}</h2>
          {current.position !== null ? (
            <p className="font-lq text-lg font-semibold text-lq-accent">
              {current.position === 1
                ? t("quizPlay.waiting.positionNext")
                : t("quizPlay.waiting.position", { position: format.format(current.position) })}
            </p>
          ) : null}
          <p className="font-lq-mono text-sm text-lq-fg-muted">
            {current.waiting === 1 ? t("quizPlay.waiting.waitingOne") : t("quizPlay.waiting.waitingMany", { count: format.format(current.waiting) })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <h2 className="font-lq text-2xl font-extrabold text-balance text-lq-fg">{t("quizPlay.waiting.approvalTitle")}</h2>
          <p className="text-sm text-lq-fg-muted">{t("quizPlay.waiting.approvalText")}</p>
        </div>
      )}

      {/* Only what deserves an announcement: the reason, then each new place in line. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {wait.failures > 0 ? (
        <p className="rounded-[calc(var(--lq-radius)*0.5)] bg-lq-warning px-3 py-2 text-sm font-semibold text-lq-on-warning">{t("quizPlay.waiting.reconnecting")}</p>
      ) : (
        <p className="max-w-sm text-sm text-lq-fg-muted">{t("quizPlay.waiting.keepOpen")}</p>
      )}

      <LqButton
        variant="secondary"
        className="w-full"
        busy={wait.leaving}
        busyLabel={t("quizPlay.waiting.leaving")}
        onClick={() => {
          void wait.leave().then(onLeft);
        }}
      >
        {t("quizPlay.waiting.leave")}
      </LqButton>
    </div>
  );
}

/** Rejected, expired, withdrawn or an invalid ticket: the right message and "Tentar de novo". */
function WaitingEnded({ end, onRetry }: { end: WaitingEnd; onRetry: () => void }) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 ref={headingRef} tabIndex={-1} className="font-lq text-2xl font-extrabold text-lq-fg outline-none">
        {t(`quizPlay.waiting.ended.${end}.title`)}
      </h2>
      <p role="status" className="text-sm text-lq-fg-muted">
        {t(`quizPlay.waiting.ended.${end}.text`)}
      </p>
      <LqButton className="w-full" onClick={onRetry}>
        {t("quizPlay.waiting.retry")}
      </LqButton>
    </div>
  );
}
