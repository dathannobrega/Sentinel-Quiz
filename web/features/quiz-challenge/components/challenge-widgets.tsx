"use client";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveChallengeFunnel, LiveChallengeState } from "@/types/api";

const STATE_TONE: Record<LiveChallengeState, BadgeTone> = { scheduled: "primary", open: "success", closed: "neutral" };

/** "Agendado" / "Aberto" / "Encerrado" (owner screens). */
export function ChallengeStateBadge({ state }: { state: LiveChallengeState }) {
  const { t } = useI18n();
  return (
    <Badge tone={STATE_TONE[state]}>
      {state === "open" ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current motion-safe:animate-[pulse-soft_1.2s_ease-in-out_infinite]" /> : null}
      {t(`quizChallenge.states.${state}`)}
    </Badge>
  );
}

/** "Desafio" marker for self-paced sessions in lists and reports. */
export function ChallengeBadge() {
  const { t } = useI18n();
  return (
    <Badge tone="primary" className="border border-current/30">
      {t("quizChallenge.sessions.badge")}
    </Badge>
  );
}

/** RF-813: the attempt came from a device someone else already used. */
export function RepeatSuspectBadge() {
  const { t } = useI18n();
  const hint = t("quizChallenge.repeat.hint");
  return (
    <Badge tone="warning" title={hint}>
      <span aria-hidden="true">⚑</span>
      {t("quizChallenge.repeat.badge")}
      <span className="sr-only">: {hint}</span>
    </Badge>
  );
}

const FUNNEL_STEPS = ["opened", "joined", "started", "finished"] as const;

/** Share of each step relative to the widest one (the first non-zero), 0..100. */
export function funnelPercents(funnel: LiveChallengeFunnel): Record<(typeof FUNNEL_STEPS)[number], number> {
  // People may join without "opening" (a stored token skips the counter), so the base is the max.
  const base = Math.max(1, ...FUNNEL_STEPS.map((step) => funnel[step] ?? 0));
  return Object.fromEntries(FUNNEL_STEPS.map((step) => [step, Math.round(((funnel[step] ?? 0) / base) * 100)])) as Record<
    (typeof FUNNEL_STEPS)[number],
    number
  >;
}

/** Funnel as simple horizontal bars: opened → joined → started → finished (RF-1029). */
export function FunnelBars({ funnel, className }: { funnel: LiveChallengeFunnel; className?: string }) {
  const { t, locale } = useI18n();
  const percents = funnelPercents(funnel);
  const number = new Intl.NumberFormat(locale);
  return (
    <ol className={cn("flex flex-col gap-2.5", className)}>
      {FUNNEL_STEPS.map((step, index) => (
        <li key={step} className="grid grid-cols-[minmax(7rem,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="text-fg-muted">{t(`quizChallenge.funnel.${step}`)}</span>
          <span aria-hidden="true" className="h-3 overflow-hidden rounded-full bg-surface-muted">
            <span
              className="block h-full origin-left rounded-full bg-primary motion-safe:animate-[grow-x_700ms_var(--ease-out)_both]"
              style={{ width: `${percents[step]}%`, animationDelay: `${index * 80}ms`, opacity: 1 - index * 0.12 }}
            />
          </span>
          <span className="nums w-10 text-right font-semibold text-fg" aria-label={t("quizChallenge.funnel.value", { label: t(`quizChallenge.funnel.${step}`), count: funnel[step] ?? 0 })}>
            {number.format(funnel[step] ?? 0)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "1 tentativa: 28 pessoas · 2 tentativas: 2 pessoas" as bars. */
export function AttemptsDistribution({ distribution }: { distribution: Record<string, number> }) {
  const { t, locale } = useI18n();
  const rows = Object.entries(distribution)
    .map(([attempts, people]) => ({ attempts: Number(attempts), people }))
    .filter((row) => Number.isFinite(row.attempts))
    .sort((a, b) => a.attempts - b.attempts);
  if (!rows.length) {
    return <p className="text-sm text-fg-muted">{t("quizChallenge.attempts.none")}</p>;
  }
  const max = Math.max(1, ...rows.map((row) => row.people));
  const number = new Intl.NumberFormat(locale);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.attempts} className="grid grid-cols-[minmax(7rem,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="text-fg-muted">
            {row.attempts === 1 ? t("quizChallenge.attempts.one") : t("quizChallenge.attempts.many", { count: row.attempts })}
          </span>
          <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-surface-muted">
            <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.round((row.people / max) * 100)}%` }} />
          </span>
          <span className="nums text-right text-fg">
            {row.people === 1 ? t("quizChallenge.attempts.peopleOne") : t("quizChallenge.attempts.people", { count: number.format(row.people) })}
          </span>
        </li>
      ))}
    </ul>
  );
}
