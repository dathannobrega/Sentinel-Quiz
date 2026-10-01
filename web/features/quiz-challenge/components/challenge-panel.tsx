"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { QrCode } from "@/components/quiz-kit/qr-code";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyIcon, QrIcon } from "@/features/quiz-builder/components/icons";
import { AttemptsDistribution, ChallengeBadge, ChallengeStateBadge, FunnelBars, RepeatSuspectBadge } from "@/features/quiz-challenge/components/challenge-widgets";
import { parseLocalInput, toLocalInputValue } from "@/features/quiz-challenge/lib/challenge-form";
import { createChallengeClock, formatClock, formatDurationShort, remainingMs, syncClock } from "@/features/quiz-challenge/lib/challenge-time";
import { sessionQrSvgUrl } from "@/lib/api/live-authoring";
import { toChallengeOwnerErrorCode } from "@/lib/api/live-challenge";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useChallengeProgress, useLiveSession, useUpdateChallenge } from "@/lib/query/live-hooks";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { LiveChallengeProgress, LiveSession } from "@/types/api";

const DAY_MS = 86_400_000;

/**
 * Owner panel of a challenge (RF-809): state and countdowns, link + QR, funnel, attempts, the
 * top 10 and recent finishes with the repeat mark (RF-813); "Adiar prazo", "Fechar agora" and the
 * report. Polled every 10 s while the tab is visible.
 */
export function ChallengePanelShell({ quizId, sessionId }: { quizId: string; sessionId: string }) {
  const { t } = useI18n();
  const progress = useChallengeProgress(sessionId);
  const session = useLiveSession(sessionId);
  return (
    <Page width="wide">
      <Link
        href={`/quizzes/${encodeURIComponent(quizId)}/sessions`}
        className="focus-ring -mb-4 inline-flex items-center gap-1.5 self-start rounded-sm text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
      >
        <ArrowLeftIcon />
        {t("quizChallenge.panel.back")}
      </Link>
      {progress.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton height={64} className="max-w-xl" />
          <Skeleton height={200} />
          <Skeleton height={240} />
        </div>
      ) : progress.isError || !progress.data ? (
        <QueryErrorBanner
          error={progress.error}
          title={progress.error instanceof ApiError && progress.error.status === 404 ? t("quizChallenge.panel.notFound") : t("quizChallenge.panel.loadError")}
          onRetry={() => void progress.refetch()}
          retrying={progress.isFetching}
        />
      ) : (
        <ChallengePanel quizId={quizId} sessionId={sessionId} progress={progress.data} session={session.data ?? null} fetching={progress.isFetching} />
      )}
    </Page>
  );
}

export function ChallengePanel({
  quizId,
  sessionId,
  progress,
  session,
  fetching = false
}: {
  quizId: string;
  sessionId: string;
  progress: LiveChallengeProgress;
  session: LiveSession | null;
  fetching?: boolean;
}) {
  const { t, locale } = useI18n();
  const challenge = progress.challenge;
  const number = new Intl.NumberFormat(locale);
  const [clock] = useState(() => createChallengeClock(progress.generated_at));
  useEffect(() => {
    syncClock(clock, progress.generated_at);
  }, [clock, progress.generated_at]);
  const now = useTicker(clock);
  const update = useUpdateChallenge(sessionId);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const closed = challenge.state === "closed";

  const countdown = useMemo(() => {
    if (challenge.state === "scheduled") {
      return { key: "opensIn", ms: remainingMs(challenge.opens_at, now) };
    }
    if (challenge.state === "open") {
      return { key: "closesIn", ms: remainingMs(challenge.closes_at, now) };
    }
    return null;
  }, [challenge.state, challenge.opens_at, challenge.closes_at, now]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(challenge.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function closeNow() {
    setActionError(null);
    try {
      await update.mutateAsync({ close_now: true });
    } catch (caught) {
      setActionError(t(`quizChallenge.create.errors.${toChallengeOwnerErrorCode(caught)}`));
    } finally {
      setCloseOpen(false);
    }
  }

  const title = session?.quiz_title ?? t("quizChallenge.meta.panelTitle");

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <p className="mb-1 flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg-muted">
            <ChallengeBadge />
            <ChallengeStateBadge state={challenge.state} />
            <span className="font-mono tracking-wider">{challenge.slug}</span>
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg sm:text-[1.75rem] sm:leading-tight">{title}</h1>
          <p className="mt-2 text-[0.9375rem] text-fg-muted">
            {t("quizChallenge.panel.window", { opens: formatDateTime(challenge.opens_at, locale), closes: formatDateTime(challenge.closes_at, locale) })}
          </p>
          {countdown && countdown.ms !== null ? (
            <p className="mt-1 text-[0.9375rem] font-semibold text-fg">
              {t(`quizChallenge.panel.${countdown.key}`, { time: countdown.ms >= DAY_MS ? formatDurationShort(countdown.ms) : formatClock(countdown.ms) })}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-fg-subtle" aria-live="off">
            {t("quizChallenge.panel.updated", { time: formatDateTime(progress.generated_at, locale) })}
            {fetching ? ` · ${t("quizChallenge.panel.refreshing")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!closed ? (
            <>
              <Button variant="secondary" onClick={() => setPostponeOpen(true)}>
                {t("quizChallenge.panel.postpone")}
              </Button>
              <Button variant="danger" onClick={() => setCloseOpen(true)}>
                {t("quizChallenge.panel.closeNow")}
              </Button>
            </>
          ) : null}
          <Link href={`/quizzes/${encodeURIComponent(quizId)}/results/${encodeURIComponent(sessionId)}`} className={buttonClassName("primary", "md")}>
            {t("quizChallenge.panel.report")}
          </Link>
        </div>
      </header>

      {actionError ? <Alert tone="danger" role="alert" message={actionError} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <PanelSection id="challenge-funnel" title={t("quizChallenge.funnel.title")} description={t("quizChallenge.funnel.description")}>
            <FunnelBars funnel={progress.funnel} />
          </PanelSection>

          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <PanelStat label={t("quizChallenge.panel.stats.inProgress")} value={number.format(progress.in_progress)} />
            <PanelStat label={t("quizChallenge.panel.stats.attempts")} value={number.format(progress.attempts)} />
            <PanelStat label={t("quizChallenge.panel.stats.median")} value={formatDurationShort(progress.median_duration_ms)} />
            <PanelStat
              label={t("quizChallenge.panel.stats.repeat")}
              value={number.format(progress.repeat_suspects)}
              tone={progress.repeat_suspects > 0 ? "warning" : undefined}
            />
          </dl>

          <PanelSection id="challenge-attempts" title={t("quizChallenge.attempts.title")}>
            <AttemptsDistribution distribution={progress.attempts_per_person} />
          </PanelSection>

          <PanelSection id="challenge-leaderboard" title={t("quizChallenge.panel.leaderboard.title")}>
            {progress.leaderboard.length ? (
              <div className="overflow-x-auto rounded-lg border border-line bg-surface">
                <table className="w-full min-w-[24rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[0.8125rem] text-fg-muted">
                      <th scope="col" className="px-3 py-2 text-right font-medium">{t("quizChallenge.panel.leaderboard.rank")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("quizChallenge.panel.leaderboard.name")}</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">{t("quizChallenge.panel.leaderboard.score")}</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">{t("quizChallenge.panel.leaderboard.correct")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progress.leaderboard.map((row) => (
                      <tr key={row.participant_id} className="border-b border-line last:border-b-0">
                        <td className="nums px-3 py-2 text-right font-mono text-xs font-semibold text-fg-muted">{row.rank}</td>
                        <td className="px-3 py-2 font-medium text-fg">{row.display_name}</td>
                        <td className="nums px-3 py-2 text-right font-semibold text-fg">{number.format(row.score)}</td>
                        <td className="nums px-3 py-2 text-right text-fg">{number.format(row.correct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line-strong px-5 py-6 text-sm text-fg-muted">{t("quizChallenge.panel.leaderboard.empty")}</p>
            )}
          </PanelSection>

          <PanelSection id="challenge-recent" title={t("quizChallenge.panel.recent.title")}>
            {progress.recent.length ? (
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
                {progress.recent.map((row) => (
                  <li key={`${row.participant_id}-${row.attempt_no}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                    <span className="font-medium text-fg">{row.display_name}</span>
                    <span className="text-xs text-fg-muted">{t("quizChallenge.panel.recent.attempt", { n: row.attempt_no })}</span>
                    {row.repeat_suspect ? <RepeatSuspectBadge /> : null}
                    <span className="text-xs text-fg-muted">{row.finish_reason ? t(`quizChallenge.reasons.${row.finish_reason}`) : null}</span>
                    <span className="nums ml-auto text-fg">
                      {t("quizChallenge.panel.recent.score", { score: number.format(row.score), correct: row.correct })}
                    </span>
                    <span className="nums w-full text-xs text-fg-subtle sm:w-auto">{formatDateTime(row.finished_at, locale)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-line-strong px-5 py-6 text-sm text-fg-muted">{t("quizChallenge.panel.recent.empty")}</p>
            )}
          </PanelSection>
        </div>

        <aside className="flex flex-col gap-4">
          <section aria-labelledby="challenge-share-title" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <h2 id="challenge-share-title" className="text-base font-semibold text-fg">
              {t("quizChallenge.panel.share.title")}
            </h2>
            <p className="text-[0.8125rem] text-fg-muted">{t("quizChallenge.panel.share.text")}</p>
            <div className="mx-auto w-full max-w-56">
              <QrCode value={challenge.share_url} label={t("quizChallenge.panel.share.qrLabel", { title })} animate={false} />
            </div>
            <p className="rounded-md bg-surface-muted px-3 py-2 font-mono text-xs break-all text-fg select-all">{challenge.share_url}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void copyLink()} aria-live="polite">
                <CopyIcon />
                {copied ? t("quizChallenge.panel.share.copied") : t("quizChallenge.panel.share.copy")}
              </Button>
              <a href={sessionQrSvgUrl(sessionId)} target="_blank" rel="noopener noreferrer" className={buttonClassName("ghost", "md")}>
                <QrIcon />
                {t("quizChallenge.panel.share.qr")}
              </a>
            </div>
          </section>
          <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 text-sm">
            <h2 className="text-base font-semibold text-fg">{t("quizChallenge.panel.settings.title")}</h2>
            <SettingRow label={t("quizChallenge.panel.settings.attempts")} value={String(challenge.attempts)} />
            <SettingRow
              label={t("quizChallenge.panel.settings.time")}
              value={
                challenge.time_mode === "total"
                  ? t("quizChallenge.panel.settings.totalMinutes", { minutes: Math.round((challenge.total_time_s ?? 0) / 60) })
                  : t(`quizChallenge.create.time.${challenge.time_mode}.name`)
              }
            />
            <SettingRow label={t("quizChallenge.panel.settings.feedback")} value={t(`quizChallenge.create.feedback.${challenge.feedback}.name`)} />
            <SettingRow label={t("quizChallenge.panel.settings.leaderboard")} value={challenge.leaderboard ? t("quizChallenge.panel.settings.yes") : t("quizChallenge.panel.settings.no")} />
            <SettingRow label={t("quizChallenge.panel.settings.shuffle")} value={challenge.shuffle_items ? t("quizChallenge.panel.settings.yes") : t("quizChallenge.panel.settings.no")} />
            {session ? (
              <SettingRow
                label={t("quizChallenge.panel.settings.access")}
                value={session.allow_guests ? t("quizBuilder.sessions.guests") : t("quizBuilder.sessions.loginOnly")}
              />
            ) : null}
          </section>
        </aside>
      </div>

      {postponeOpen ? (
        <PostponeDialog
          closesAt={challenge.closes_at}
          busy={update.isPending}
          onClose={() => setPostponeOpen(false)}
          onSave={async (iso) => {
            await update.mutateAsync({ closes_at: iso });
            setPostponeOpen(false);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={closeOpen}
        title={t("quizChallenge.panel.closeConfirm.title")}
        message={t("quizChallenge.panel.closeConfirm.message")}
        confirmLabel={t("quizChallenge.panel.closeConfirm.confirm")}
        tone="danger"
        busy={update.isPending}
        onConfirm={() => void closeNow()}
        onCancel={() => setCloseOpen(false)}
      />
    </>
  );
}

/** Ticks once a second against the server clock (the panel countdowns). */
function useTicker(clock: ReturnType<typeof createChallengeClock>): number {
  const [now, setNow] = useState(() => clock.serverNow());
  useEffect(() => {
    const handle = setInterval(() => setNow(clock.serverNow()), 1000);
    return () => clearInterval(handle);
  }, [clock]);
  return now;
}

function PanelSection({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold text-fg">
          {title}
        </h2>
        {description ? <p className="mt-0.5 max-w-prose text-[0.8125rem] text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PanelStat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg border bg-surface p-4", tone === "warning" ? "border-warning/40" : "border-line")}>
      <dt className="text-[0.8125rem] text-fg-muted">{label}</dt>
      <dd className="nums text-2xl leading-none font-semibold tracking-tight text-fg">{value}</dd>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right font-medium text-fg">{value}</span>
    </div>
  );
}

/** "Adiar prazo": a new deadline (shortcuts move the current one by 1, 3 or 7 days). */
function PostponeDialog({
  closesAt,
  busy,
  onClose,
  onSave
}: {
  closesAt: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (iso: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const id = useId();
  // The base of the shortcuts: the current deadline (or now, when it already passed).
  const [current] = useState(() => Math.max(closesAt ? new Date(closesAt).getTime() : 0, Date.now()));
  const [value, setValue] = useState(() => toLocalInputValue(new Date(current + DAY_MS)));
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = parseLocalInput(value);
    if (parsed === null) {
      setError(t("quizChallenge.create.errors.closesRequired"));
      return;
    }
    if (parsed <= Date.now() + 60_000) {
      setError(t("quizChallenge.create.errors.closesPast"));
      return;
    }
    setError(null);
    try {
      await onSave(new Date(parsed).toISOString());
    } catch (caught) {
      setError(t(`quizChallenge.create.errors.${toChallengeOwnerErrorCode(caught)}`));
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      title={t("quizChallenge.panel.postponeDialog.title")}
      description={t("quizChallenge.panel.postponeDialog.description")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("quizBuilder.create.cancel")}
          </Button>
          <Button busy={busy} onClick={() => void save()}>
            {t("quizChallenge.panel.postponeDialog.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("quizChallenge.create.window.closesAt")} htmlFor={`${id}-closes`} error={error} hintMode="none">
          <Input id={`${id}-closes`} type="datetime-local" value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <div role="group" aria-label={t("quizChallenge.create.window.shortcuts")} className="flex flex-wrap gap-2">
          {[1, 3, 7].map((days) => (
            <Button key={days} size="sm" variant="secondary" className="min-h-11" disabled={busy} onClick={() => setValue(toLocalInputValue(new Date(current + days * DAY_MS)))}>
              {t(`quizChallenge.panel.postponeDialog.plus${days}`)}
            </Button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
