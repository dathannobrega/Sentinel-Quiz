"use client";

import { useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page, PageHeader } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { CapabilityGate } from "@/features/quiz-builder/components/capability-gate";
import { PresentIcon, QrIcon } from "@/features/quiz-builder/components/icons";
import { sessionQrSvgUrl } from "@/lib/api/live-authoring";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useEndLiveSession, useLiveQuiz, useLiveSessions } from "@/lib/query/live-hooks";
import { formatDateTime } from "@/lib/utils/format";
import type { LiveSession, LiveSessionStatus } from "@/types/api";

const STATUS_TONE: Record<LiveSessionStatus, BadgeTone> = { lobby: "primary", live: "warning", finished: "neutral" };

export function QuizSessionsShell({ quizId }: { quizId: string }) {
  return (
    <Page width="wide">
      <CapabilityGate>{() => <SessionsContent quizId={quizId} />}</CapabilityGate>
    </Page>
  );
}

export function SessionStatusBadge({ status }: { status: LiveSessionStatus }) {
  const { t } = useI18n();
  return (
    <Badge tone={STATUS_TONE[status]}>
      {status === "live" ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current motion-safe:animate-[pulse-soft_1.2s_ease-in-out_infinite]" /> : null}
      {t(`quizBuilder.sessionStatus.${status}`)}
    </Badge>
  );
}

function SessionsContent({ quizId }: { quizId: string }) {
  const { t, locale } = useI18n();
  const quiz = useLiveQuiz(quizId);
  const sessions = useLiveSessions(quizId, { refetchInterval: 15_000 });
  const endSession = useEndLiveSession();
  const [endTarget, setEndTarget] = useState<LiveSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = sessions.data ?? [];

  async function confirmEnd() {
    if (!endTarget) return;
    setError(null);
    try {
      await endSession.mutateAsync(endTarget.id);
    } catch (caught) {
      setError(readErrorMessage(caught, t("quizBuilder.library.actionError")));
    } finally {
      setEndTarget(null);
    }
  }

  return (
    <>
      <Link
        href={`/quizzes/${encodeURIComponent(quizId)}/edit`}
        className="focus-ring -mb-4 inline-flex items-center gap-1.5 self-start rounded-sm text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
      >
        <ArrowLeftIcon />
        {t("quizBuilder.sessions.back")}
      </Link>
      <PageHeader
        context={t("quizBuilder.sessions.context")}
        title={quiz.data ? t("quizBuilder.sessions.title", { title: quiz.data.title }) : t("quizBuilder.metadata.sessions")}
        description={t("quizBuilder.sessions.description")}
      />
      {error ? <Alert tone="danger" role="alert" message={error} /> : null}
      {sessions.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} height={52} />
          ))}
        </div>
      ) : sessions.isError ? (
        <QueryErrorBanner
          error={sessions.error}
          title={t("quizBuilder.sessions.loadError")}
          onRetry={() => void sessions.refetch()}
          retrying={sessions.isFetching}
        />
      ) : list.length === 0 ? (
        <EmptyState
          title={t("quizBuilder.sessions.empty")}
          action={
            <Link href={`/quizzes/${encodeURIComponent(quizId)}/edit`} className={buttonClassName("primary", "md")}>
              <PresentIcon />
              {t("quizBuilder.editor.present")}
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">{t("quizBuilder.sessions.context")}</caption>
            <thead>
              <tr className="border-b border-line text-left text-[0.8125rem] text-fg-muted">
                <th scope="col" className="px-4 py-3 font-medium">{t("quizBuilder.sessions.columns.date")}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t("quizBuilder.sessions.columns.status")}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t("quizBuilder.sessions.columns.version")}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t("quizBuilder.sessions.columns.code")}</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">{t("quizBuilder.sessions.columns.participants")}</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">{t("quizBuilder.sessions.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((session, index) => (
                <tr
                  key={session.id}
                  className="border-b border-line last:border-b-0 hover:bg-surface-muted/50 motion-safe:animate-[rise-in_260ms_var(--ease-out)_both]"
                  style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-fg">{formatDateTime(session.started_at ?? session.created_at, locale)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SessionStatusBadge status={session.status} />
                      <span className="text-xs text-fg-muted">
                        {session.allow_guests ? t("quizBuilder.sessions.guests") : t("quizBuilder.sessions.loginOnly")}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-muted">v{session.version_no}</td>
                  <td className="px-4 py-3 font-mono tracking-wider text-fg">{session.join_code}</td>
                  <td className="nums px-4 py-3 text-right text-fg">{session.participant_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {session.status === "finished" ? (
                        <Link
                          href={`/quizzes/${encodeURIComponent(quizId)}/results/${encodeURIComponent(session.id)}`}
                          className={buttonClassName("secondary", "sm")}
                        >
                          {t("quizBuilder.sessions.results")}
                        </Link>
                      ) : (
                        <>
                          <Link href={`/present/${encodeURIComponent(session.id)}`} className={buttonClassName("primary", "sm")}>
                            <PresentIcon />
                            {t("quizBuilder.sessions.resume")}
                          </Link>
                          <a
                            href={sessionQrSvgUrl(session.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonClassName("ghost", "sm")}
                          >
                            <QrIcon />
                            {t("quizBuilder.sessions.qr")}
                          </a>
                          <Button variant="danger" size="sm" onClick={() => setEndTarget(session)}>
                            {t("quizBuilder.sessions.end")}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={endTarget !== null}
        title={t("quizBuilder.sessions.endConfirm.title", { code: endTarget?.join_code ?? "" })}
        message={t("quizBuilder.sessions.endConfirm.message")}
        confirmLabel={t("quizBuilder.sessions.endConfirm.confirm")}
        tone="danger"
        busy={endSession.isPending}
        onConfirm={() => void confirmEnd()}
        onCancel={() => setEndTarget(null)}
      />
    </>
  );
}
