"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { API_TIMEOUTS, ApiError, apiClient, readErrorMessage } from "@/lib/api/client";
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
        { timeoutMs: API_TIMEOUTS.tutor }
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
    body = <StatusBanner tone="neutral" message={t("runner.tutor.lockedDuringExam")} />;
  } else if (needsLogin) {
    body = (
      <StatusBanner
        tone="warning"
        message={t("runner.tutor.authRequired")}
        action={
          <Link href={loginHref} className="sq-button sq-button--sm sq-button--primary">
            {t("runner.tutor.signIn")}
          </Link>
        }
      />
    );
  } else if (answered) {
    body = (
      <>
        <div className="sq-actions sq-gap-top-sm">
          {(
            [
              ["help", "runner.tutor.explain"],
              ["why_wrong", "runner.tutor.whyWrong"],
              ["review", "runner.tutor.reviewTopic"]
            ] as const
          ).map(([mode, labelKey]) => (
            <Button
              key={mode}
              variant="ghost"
              size="sm"
              busy={pendingMode === mode}
              disabled={pendingMode !== null && pendingMode !== mode}
              onClick={() => void ask(mode)}
            >
              {t(labelKey)}
            </Button>
          ))}
        </div>
        <div aria-live="polite" className="sq-gap-top-sm">
          {pendingMode ? <div className="sq-list-meta">{t("runner.tutor.thinking")}</div> : null}
          {failure ? (
            <StatusBanner tone={failure.kind === "quota" ? "warning" : "danger"} role="alert" message={failure.message} />
          ) : null}
          {reply ? (
            <div className="sq-list-meta" aria-label={t("runner.tutor.replyLabel")} role="region">
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
    <div className="sq-runner-utility">
      <div className="sq-runner-utility__head">
        <div>
          <div className="sq-list-title">{t("runner.tutor.title")}</div>
          <div className="sq-list-meta">{t("runner.tutor.subtitle")}</div>
        </div>
      </div>
      <div className="sq-gap-top-sm">{body}</div>
    </div>
  );
}
