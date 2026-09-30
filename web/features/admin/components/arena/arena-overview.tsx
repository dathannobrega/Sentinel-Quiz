"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Section } from "@/components/ui/section";
import { Stat, StatList } from "@/components/ui/stat";
import { formatJoinCode } from "@/features/quiz-live/lib/protocol";
import { toLiveAdminErrorCode } from "@/lib/api/live-admin";
import { useI18n } from "@/lib/i18n";
import { useForceEndLiveSession, useLiveAdminOverview } from "@/lib/query/live-admin-hooks";
import { formatDateTime } from "@/lib/utils/format";
import type { LiveAdminActiveSession } from "@/types/api";

import { ReasonDialog } from "@/features/admin/components/arena/reason-dialog";

/** RF-1102: active rooms across the platform; admins can force-end one (RF-1103, audited). */
export function ArenaOverview({ canAdmin }: { canAdmin: boolean }) {
  const { t, locale } = useI18n();
  const overview = useLiveAdminOverview({ enabled: true });
  const forceEnd = useForceEndLiveSession();
  const [ending, setEnding] = useState<LiveAdminActiveSession | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const number = new Intl.NumberFormat(locale);

  function confirmEnd(reason: string) {
    if (!ending) {
      return;
    }
    const target = ending;
    setEndError(null);
    forceEnd.mutate(
      { sessionId: target.id, reason },
      {
        onSuccess: () => {
          setEnding(null);
          setNotice(t("admin.arena.overview.ended", { code: formatJoinCode(target.join_code) }));
        },
        onError: (error) => setEndError(t(`admin.arena.errors.${toLiveAdminErrorCode(error)}`))
      }
    );
  }

  const totals = overview.data?.totals;
  const sessions = overview.data?.active_sessions ?? [];

  return (
    <Section
      title={t("admin.arena.overview.title")}
      description={t("admin.arena.overview.subtitle")}
      actions={
        <Button variant="secondary" size="sm" busy={overview.isFetching && !overview.isPending} onClick={() => void overview.refetch()}>
          {t("admin.arena.common.refresh")}
        </Button>
      }
    >
      {notice ? <Alert tone="success" message={notice} /> : null}
      {overview.isPending ? (
        <p role="status" className="text-sm text-fg-muted">
          {t("admin.arena.common.loading")}
        </p>
      ) : overview.isError ? (
        <QueryErrorBanner error={overview.error} title={t("admin.arena.overview.loadError")} onRetry={() => void overview.refetch()} retrying={overview.isFetching} />
      ) : (
        <>
          {totals ? (
            <StatList>
              <Stat label={t("admin.arena.overview.totals.active_sessions")} value={number.format(totals.active_sessions)} emphasis />
              <Stat label={t("admin.arena.overview.totals.participants")} value={number.format(totals.participants)} />
              <Stat label={t("admin.arena.overview.totals.online")} value={number.format(totals.online)} />
              <Stat label={t("admin.arena.overview.totals.open_cases")} value={number.format(totals.open_cases)} />
            </StatList>
          ) : null}
          {sessions.length ? (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                <caption className="sr-only">{t("admin.arena.overview.caption")}</caption>
                <thead>
                  <tr className="border-b border-line text-xs text-fg-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.overview.columns.code")}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.overview.columns.quiz")}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.overview.columns.owner")}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.overview.columns.phase")}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.overview.columns.people")}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.overview.columns.created")}</th>
                    {canAdmin ? (
                      <th scope="col" className="py-2 font-medium">
                        <span className="sr-only">{t("admin.arena.overview.columns.actions")}</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id} className="border-b border-line align-top last:border-b-0">
                      <td className="py-2.5 pr-3 font-mono whitespace-nowrap text-fg">{formatJoinCode(session.join_code)}</td>
                      <td className="py-2.5 pr-3">
                        <span className="line-clamp-2 font-medium text-fg">{session.quiz_title}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {session.rehearsal ? <Badge tone="warning">{t("admin.arena.overview.rehearsal")}</Badge> : null}
                          <Badge>{session.allow_guests ? t("admin.arena.overview.guests") : t("admin.arena.overview.loginOnly")}</Badge>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-fg-muted [overflow-wrap:anywhere]">{session.owner_email}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-fg">{t(`admin.arena.overview.phases.${session.phase}`)}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="nums text-fg">
                          {t("admin.arena.overview.people", { participants: number.format(session.participants), online: number.format(session.online) })}
                        </span>
                        <span className="block text-xs text-fg-subtle">{t("admin.arena.overview.limit", { max: number.format(session.max_participants) })}</span>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-fg-muted">{formatDateTime(session.created_at, locale)}</td>
                      {canAdmin ? (
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setEndError(null);
                              setNotice(null);
                              setEnding(session);
                            }}
                            aria-label={`${t("admin.arena.overview.end")} ${formatJoinCode(session.join_code)}`}
                          >
                            {t("admin.arena.overview.end")}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState size="compact" description={t("admin.arena.overview.empty")} />
          )}
        </>
      )}
      <ReasonDialog
        open={ending !== null}
        title={t("admin.arena.overview.endTitle", { code: ending ? formatJoinCode(ending.join_code) : "" })}
        message={t("admin.arena.overview.endText")}
        label={t("admin.arena.common.reasonLabel")}
        hint={t("admin.arena.common.reasonHint")}
        required
        confirmLabel={t("admin.arena.overview.confirmEnd")}
        busy={forceEnd.isPending}
        error={endError}
        onCancel={() => setEnding(null)}
        onConfirm={confirmEnd}
      />
    </Section>
  );
}
