"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { SparkIcon, SpinnerIcon } from "@/components/ui/icons";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { ApiError, apiClient, getTutorTimeoutMs, readErrorMessage } from "@/lib/api/client";
import { useSessionRole } from "@/lib/query/hooks";
import type { TutorMode, TutorReply } from "@/types/api";

export type TutorFailureKind = "auth" | "locked" | "quota" | "unavailable" | "other";

export interface TutorFailure {
  kind: TutorFailureKind;
  message: string;
}

/** Maps tutor API errors (contract §3) to a user-facing explanation. */
export function describeTutorError(error: unknown, t: Translate): TutorFailure {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.code === "auth_required") {
      return { kind: "auth", message: t("runner.tutor.authRequired") };
    }
    if (error.code === "tutor_unavailable_during_exam" || error.status === 409) {
      return { kind: "locked", message: t("runner.tutor.lockedDuringExam") };
    }
    if (error.code === "tutor_quota_exceeded" || error.status === 429) {
      return {
        kind: "quota",
        message: error.retryAfterSeconds
          ? t("runner.tutor.quotaRetry", { seconds: error.retryAfterSeconds })
          : t("runner.tutor.quotaExceeded")
      };
    }
    if (error.code === "tutor_upstream_error" || error.status === 502 || error.status === 503 || error.status === 504) {
      return { kind: "unavailable", message: t("runner.tutor.unavailable") };
    }
  }
  return { kind: "other", message: readErrorMessage(error, t("runner.errors.actionFailed")) };
}

interface TutorPanelProps {
  sessionId: string;
  questionId: string;
  /** Exam still in progress: the backend answers 409, so we explain instead of calling it. */
  lockedDuringExam: boolean;
  /** The tutor is only offered after the question has been answered. */
  answered: boolean;
  t: Translate;
}

/** Mount with `key={questionId}` so the reply resets per question. */
export function TutorPanel({ sessionId, questionId, lockedDuringExam, answered, t }: TutorPanelProps) {
  const pathname = usePathname();
  const { isAuthenticated, isResolved } = useSessionRole();
  const [pendingMode, setPendingMode] = useState<TutorMode | null>(null);
  const [reply, setReply] = useState<TutorReply | null>(null);
  const [failure, setFailure] = useState<TutorFailure | null>(null);

  async function ask(mode: TutorMode) {
    setPendingMode(mode);
    setFailure(null);
    try {
      const response = await apiClient.post<TutorReply>(
        `/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/tutor`,
        { mode },
        { timeoutMs: getTutorTimeoutMs() }
      );
      setReply(response);
    } catch (error) {
      setReply(null);
      setFailure(describeTutorError(error, t));
    } finally {
      setPendingMode(null);
    }
  }

  const loginHref = `/login?next=${encodeURIComponent(pathname || "/dashboard")}`;
  const needsLogin = (isResolved && !isAuthenticated) || failure?.kind === "auth";
  const isLocked = lockedDuringExam || failure?.kind === "locked";

  let body;
  if (isLocked) {
    body = <p className="text-[0.8125rem] leading-relaxed text-fg-muted">{t("runner.tutor.lockedDuringExam")}</p>;
  } else if (needsLogin) {
    body = (
      <Alert
        tone="warning"
        message={t("runner.tutor.authRequired")}
        action={
          <Link href={loginHref} className={buttonClassName("primary", "sm")}>
            {t("runner.tutor.signIn")}
          </Link>
        }
      />
    );
  } else if (answered) {
    body = (
      <>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["help", "runner.tutor.explain"],
              ["why_wrong", "runner.tutor.whyWrong"],
              ["review", "runner.tutor.reviewTopic"]
            ] as const
          ).map(([mode, labelKey]) => (
            <Button
              key={mode}
              variant="secondary"
              size="sm"
              busy={pendingMode === mode}
              disabled={pendingMode !== null && pendingMode !== mode}
              onClick={() => void ask(mode)}
            >
              {t(labelKey)}
            </Button>
          ))}
        </div>
        <div aria-live="polite" className="mt-3 flex flex-col gap-3">
          {pendingMode ? (
            <p className="inline-flex items-center gap-2 text-[0.8125rem] text-fg-muted">
              <SpinnerIcon />
              {t("runner.tutor.thinking")}
            </p>
          ) : null}
          {failure ? <Alert tone={failure.kind === "quota" ? "warning" : "danger"} role="alert" message={failure.message} /> : null}
          {reply ? (
            <div
              className="rounded-md bg-surface-muted px-4 py-3 font-serif text-[0.9375rem] leading-relaxed whitespace-pre-line text-fg"
              aria-label={t("runner.tutor.replyLabel")}
              role="region"
            >
              {reply.message}
            </div>
          ) : null}
        </div>
      </>
    );
  } else {
    body = null;
  }

  return (
    <section className="flex flex-col gap-3" aria-label={t("runner.tutor.title")}>
      <div>
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-fg">
          <SparkIcon className="text-primary" />
          {t("runner.tutor.title")}
        </h2>
        <p className="text-xs text-fg-muted">{t("runner.tutor.subtitle")}</p>
      </div>
      {body}
    </section>
  );
}
