"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { m } from "motion/react";

import { springs, useLqReducedMotion } from "@/components/quiz-kit/motion";
import { Dialog } from "@/components/ui/dialog";
import { LqButton, LqError, lqButtonClass, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import { getMyData, isTokenRejected } from "@/features/quiz-live/lib/live-fetch";
import { AccessForm } from "@/features/quiz-play/components/access-form";
import { claimLiveParticipation, toClaimErrorCode } from "@/lib/api/live-authoring";
import { useI18n } from "@/lib/i18n";
import { useCurrentUser } from "@/lib/query/hooks";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import type { LiveClaimStatus, LiveJoinResult } from "@/types/api/live";

type ClaimState =
  | { kind: "checking" }
  | { kind: "hidden" }
  | { kind: "available"; status: LiveClaimStatus }
  | { kind: "claiming"; status: LiveClaimStatus }
  | { kind: "done"; recorded: number }
  | { kind: "error"; status: LiveClaimStatus; message: string };

/** Return URL after sign-in/registration: back to the room, straight to the claim card. */
export function claimReturnPath(code: string): string {
  return `/j/${encodeURIComponent(code)}?claim=1`;
}

/**
 * RF-633: "Salvar meu resultado na minha conta" on the final screen, only when GET /me says the
 * claim is available (never for infantojuvenil sessions: the server answers `not_available`).
 * Signed-out people go to login/register and come back here; signed-in people claim with the
 * participant token in the body and the account session.
 */
export function ClaimCard({
  code,
  token,
  sessionId,
  defaultName,
  onTokenRefreshed
}: {
  code: string;
  token: string | null;
  sessionId: string | null;
  defaultName?: string;
  onTokenRefreshed?: (result: LiveJoinResult) => void;
}) {
  const { t, locale } = useI18n();
  const reduced = useLqReducedMotion();
  // A ref, not state: a token refreshed with the return code must not re-run the status check
  // (it would race with the claim that follows).
  const tokenRef = useRef(token);
  const [state, setState] = useState<ClaimState>(token ? { kind: "checking" } : { kind: "hidden" });
  const [needAccess, setNeedAccess] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const available = state.kind === "available" || state.kind === "claiming" || state.kind === "error";
  const user = useCurrentUser({ enabled: available });
  const signedIn = Boolean(user.data);

  useEffect(() => {
    tokenRef.current = token;
    if (!token) {
      return undefined;
    }
    const controller = new AbortController();
    getMyData(token, controller.signal)
      .then((data) => setState(data.claim.available ? { kind: "available", status: data.claim } : { kind: "hidden" }))
      .catch(() => {
        if (!controller.signal.aborted) {
          // No claim offer when the data cannot be read: the rest of the final screen still works.
          setState({ kind: "hidden" });
        }
      });
    return () => controller.abort();
  }, [token]);

  // Back from login/register (`?claim=1`): bring the card into view once it is offered.
  useEffect(() => {
    if (state.kind !== "available") {
      return;
    }
    try {
      if (new URLSearchParams(window.location.search).get("claim") === "1") {
        cardRef.current?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
        cardRef.current?.focus({ preventScroll: true });
      }
    } catch {
      // Best effort only.
    }
  }, [state.kind, reduced]);

  async function claim(status: LiveClaimStatus, withToken: string) {
    setState({ kind: "claiming", status });
    try {
      const result = await claimLiveParticipation(withToken);
      setState({ kind: "done", recorded: result.bank_answers_recorded });
    } catch (error) {
      const codeKey = toClaimErrorCode(error);
      if (codeKey === "token" || isTokenRejected(error)) {
        setState({ kind: "available", status });
        setNeedAccess(true);
        return;
      }
      setState({ kind: "error", status, message: t(`quizPlay.claim.errors.${codeKey}`) });
    }
  }

  if (state.kind === "checking" || state.kind === "hidden") {
    return null;
  }

  if (state.kind === "done") {
    return (
      <m.section
        role="status"
        className={cn(lqCardClass, "flex flex-col items-center gap-2 px-5 py-5 text-center")}
        initial={reduced ? false : { scale: 0.94 }}
        animate={{ scale: 1 }}
        transition={springs.bouncy}
      >
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-lq-success text-lg font-black text-lq-on-success">
          ✓
        </span>
        <h3 className="font-lq text-lg font-extrabold text-lq-fg">{t("quizPlay.claim.successTitle")}</h3>
        <p className="text-sm text-lq-fg-muted">
          {state.recorded > 0 ? t("quizPlay.claim.successBank", { count: state.recorded }) : t("quizPlay.claim.successNoBank")}
        </p>
      </m.section>
    );
  }

  const status = state.status;
  const returnPath = encodeURIComponent(claimReturnPath(code));
  const until = status.until ? formatDate(status.until, locale) : null;

  return (
    <section ref={cardRef} tabIndex={-1} aria-labelledby="claim-title" className={cn(lqCardClass, "flex flex-col gap-3 px-5 py-5 outline-none")}>
      <h3 id="claim-title" className="font-lq text-lg font-extrabold text-lq-fg">
        {t("quizPlay.claim.title")}
      </h3>
      <p className="text-sm leading-relaxed text-lq-fg-muted">{until ? t("quizPlay.claim.text", { date: until }) : t("quizPlay.claim.textNoDate")}</p>
      {state.kind === "error" ? <LqError>{state.message}</LqError> : null}
      {signedIn ? (
        <>
          {user.data?.email ? <p className="text-xs text-lq-fg-muted">{t("quizPlay.claim.signedInAs", { email: user.data.email })}</p> : null}
          <LqButton
            size="lg"
            busy={state.kind === "claiming"}
            busyLabel={t("quizPlay.claim.busy")}
            onClick={() => (tokenRef.current ? void claim(status, tokenRef.current) : setNeedAccess(true))}
          >
            {t("quizPlay.claim.cta")}
          </LqButton>
        </>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href={`/login?next=${returnPath}`} className={cn(lqButtonClass("primary"), "flex-1")}>
            {t("quizPlay.claim.login")}
          </Link>
          <Link href={`/register?next=${returnPath}`} className={cn(lqButtonClass("secondary"), "flex-1")}>
            {t("quizPlay.claim.register")}
          </Link>
        </div>
      )}
      <Dialog open={needAccess} onClose={() => setNeedAccess(false)} title={t("quizPlay.claim.title")}>
        {needAccess && sessionId ? (
          <AccessForm
            sessionId={sessionId}
            defaultName={defaultName}
            onAccess={(result) => {
              onTokenRefreshed?.(result);
              tokenRef.current = result.token;
              setNeedAccess(false);
              void claim(status, result.token);
            }}
          />
        ) : null}
      </Dialog>
    </section>
  );
}
