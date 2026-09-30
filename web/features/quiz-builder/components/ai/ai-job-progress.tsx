"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m } from "motion/react";

import { CheckIcon, ClockIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { useNow } from "@/features/quiz-builder/components/ai/ai-shared";
import { SparklesIcon } from "@/features/quiz-builder/components/icons";
import { JOB_STEPS, clampPct, formatElapsed, isJobActive, jobElapsedSeconds, jobStepIndex } from "@/features/quiz-builder/lib/ai";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { AiJob } from "@/types/api";

/** Elapsed time of a job ("m:ss"), ticking while it runs. */
export function JobElapsed({ job, className }: { job: AiJob; className?: string }) {
  const { t } = useI18n();
  const active = isJobActive(job.status);
  const seconds = jobElapsedSeconds(job, useNow(active));
  return (
    <span className={cn("nums inline-flex items-center gap-1 font-mono text-xs text-fg-muted", className)}>
      <ClockIcon size={13} />
      <span className="sr-only">{t("quizAi.job.elapsedLabel")}</span>
      {formatElapsed(seconds)}
    </span>
  );
}

/**
 * Staged stepper driven by job.progress (Gerando → Validando → Revisão do crítico → Pronto), with
 * a labelled progress meter. Step changes are announced politely (not every percentage point).
 */
export function JobStepper({ job, compact = false }: { job: AiJob; compact?: boolean }) {
  const { t } = useI18n();
  const current = jobStepIndex(job);
  const pct = isJobActive(job.status) ? clampPct(job.progress?.pct) : 100;
  const currentStep = JOB_STEPS[Math.min(current, JOB_STEPS.length - 1)] ?? "done";
  const announcement = isJobActive(job.status)
    ? t("quizAi.job.announce", { step: t(`quizAi.job.steps.${currentStep}.name`) })
    : "";

  return (
    <div className={cn("flex flex-col", compact ? "gap-2.5" : "gap-4")}>
      <ol aria-label={t("quizAi.job.stepsLabel")} className={cn("grid gap-2", compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4")}>
        {JOB_STEPS.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "pending";
          return (
            <li key={step} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative grid shrink-0 place-items-center rounded-full font-mono font-semibold transition-colors duration-300",
                    compact ? "size-5 text-[0.625rem]" : "size-7 text-xs",
                    state === "done" && "bg-primary text-on-primary",
                    state === "current" && "bg-primary-soft text-primary ring-2 ring-primary",
                    state === "pending" && "bg-surface-muted text-fg-subtle"
                  )}
                >
                  {state === "done" ? <CheckIcon size={compact ? 11 : 14} /> : index + 1}
                  {state === "current" ? (
                    <span className="absolute inset-0 rounded-full ring-2 ring-primary/40 motion-safe:animate-ping" />
                  ) : null}
                </span>
                {index < JOB_STEPS.length - 1 ? (
                  <span aria-hidden="true" className="h-0.5 min-w-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <span
                      className="block h-full origin-left bg-primary transition-transform duration-500 ease-out"
                      style={{ transform: `scaleX(${state === "done" ? 1 : 0})` }}
                    />
                  </span>
                ) : null}
              </div>
              <span className={cn("min-w-0", compact && "sr-only")}>
                <span className={cn("block text-[0.8125rem] font-medium", state === "pending" ? "text-fg-muted" : "text-fg")}>
                  {t(`quizAi.job.steps.${step}.name`)}
                </span>
                <span className="block text-xs leading-snug text-fg-muted">{t(`quizAi.job.steps.${step}.hint`)}</span>
                <span className="sr-only">
                  {" "}
                  ({t(`quizAi.job.stepState.${state}`)})
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-3">
        <Meter value={pct} label={t("quizAi.job.progressLabel")} className="flex-1" />
        <span className="nums w-10 text-right font-mono text-xs text-fg-muted">{pct}%</span>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

const SKELETON_CAP = 6;

/**
 * Draft skeletons "being written": the number of cards grows with the progress, each entering with
 * a short rise (transform only; reduced motion skips it) and a shimmer sweep.
 */
export function DraftSkeletons({ job, expected }: { job: AiJob; expected: number }) {
  const { t } = useI18n();
  const total = Math.max(1, Math.min(SKELETON_CAP, expected));
  const pct = clampPct(job.progress?.pct);
  const visible = Math.max(1, Math.min(total, Math.ceil((total * Math.max(pct, 12)) / 70)));
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-[0.8125rem] text-fg-muted">
        <SparklesIcon className="text-primary motion-safe:animate-[pulse-soft_1.6s_ease-in-out_infinite]" />
        {t("quizAi.job.writing")}
      </p>
      <AnimatePresence initial={false}>
        {Array.from({ length: visible }, (_, index) => (
          <m.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", visualDuration: 0.4, bounce: 0.15 }}
            className="ai-shimmer relative overflow-hidden rounded-lg border border-line bg-surface p-4"
          >
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-sm bg-surface-muted" />
              <span className="h-3 w-24 rounded-sm bg-surface-muted" />
              <span className="ml-auto h-3 w-12 rounded-full bg-surface-muted" />
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <span className="h-3.5 w-11/12 rounded-sm bg-surface-muted" />
              <span className="h-3.5 w-3/5 rounded-sm bg-surface-muted" />
            </div>
            <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
              {[0, 1, 2, 3].map((line) => (
                <span key={line} className="h-7 rounded-md bg-surface-muted" />
              ))}
            </div>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Full progress panel for a running generation: stepper, elapsed time, skeleton drafts and the
 * reminder that closing the dialog does not cancel the job.
 */
export function JobProgressPanel({ job, expected }: { job: AiJob; expected: number }) {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 45_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="ai-surface flex flex-col gap-4 rounded-lg border border-line p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-fg">{t(`quizAi.job.running.${job.status === "queued" ? "queued" : "running"}`)}</p>
          <JobElapsed job={job} />
        </div>
        <JobStepper job={job} />
        <p className="text-xs leading-snug text-fg-muted">{slow ? t("quizAi.job.slow") : t("quizAi.job.background")}</p>
      </div>
      <DraftSkeletons job={job} expected={expected} />
    </div>
  );
}
