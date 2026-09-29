"use client";

import { useId, useState } from "react";

import { AlertIcon, CheckIcon, InfoIcon, XIcon } from "@/components/ui/icons";
import { ReferencesList } from "@/features/session-runner/components/references-list";
import { formatPbqScoreLine, pbqCreditLabel } from "@/features/session-runner/lib/pbq-utils";
import { buildLiveFeedbackBits, type AnswerFeedback, type Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";

const LONG_EXPLANATION = 700;

type Verdict = "correct" | "wrong" | "partial" | "recorded";

const verdictStyle: Record<Verdict, { rail: string; badge: string; title: string; Icon: typeof CheckIcon }> = {
  correct: { rail: "border-success", badge: "bg-success text-surface", title: "text-success", Icon: CheckIcon },
  wrong: { rail: "border-danger", badge: "bg-danger text-surface", title: "text-danger", Icon: XIcon },
  partial: { rail: "border-warning", badge: "bg-warning text-surface", title: "text-warning", Icon: AlertIcon },
  recorded: { rail: "border-line-strong", badge: "bg-surface-muted text-fg-muted", title: "text-fg", Icon: InfoIcon }
};

function Explanation({ text, t }: { text: string; t: Translate }) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const isLong = text.length > LONG_EXPLANATION;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase">{t("runner.resolution.explanation")}</h3>
      <p
        id={bodyId}
        className={cn("font-serif text-[1.0625rem] leading-[1.7] whitespace-pre-line text-fg", isLong && !expanded && "line-clamp-6")}
      >
        {text}
      </p>
      {isLong ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
          className="focus-ring self-start rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {expanded ? t("runner.resolution.readLess") : t("runner.resolution.readMore")}
        </button>
      ) : null}
    </div>
  );
}

interface AnswerFeedbackProps {
  feedback: AnswerFeedback;
  isPbq: boolean;
  isExamDayMode: boolean;
  t: Translate;
}

/**
 * Verdict + resolution, shown only after submission. Verdict = icon + words + tone (never color only);
 * the explanation is set in the reading face and collapsed when long.
 */
export function AnswerFeedbackView({ feedback, isPbq, isExamDayMode, t }: AnswerFeedbackProps) {
  if (isExamDayMode) {
    const style = verdictStyle.recorded;
    return (
      <section className={cn("flex items-start gap-3 border-l-[3px] py-1 pl-4", style.rail)} role="status">
        <div>
          <p className="font-semibold text-fg">{t("runner.examDay.answerRecordedTitle")}</p>
          <p className="text-sm text-fg-muted">{t("runner.examDay.answerRecordedMessage")}</p>
        </div>
      </section>
    );
  }

  const bits = buildLiveFeedbackBits(feedback, t);
  let verdict: Verdict;
  let title: string;
  let summary: string;
  let explanation: string | null = null;

  if (isPbq) {
    verdict = feedback.is_correct ? "correct" : (feedback.score ?? 0) > 0 ? "partial" : "wrong";
    title = `${t("pbq.feedback.title")}: ${pbqCreditLabel(feedback.score, t)}`;
    summary = [formatPbqScoreLine(feedback, t), feedback.feedback_summary?.trim()].filter(Boolean).join(" — ");
  } else {
    verdict = feedback.is_correct ? "correct" : "wrong";
    title = feedback.is_correct ? t("runner.feedback.correct") : t("runner.feedback.wrong");
    const rawSummary = feedback.feedback_summary?.trim() || "";
    const justification = feedback.justification?.trim() || "";
    summary = rawSummary && rawSummary !== justification ? rawSummary : "";
    explanation = justification || (rawSummary ? null : t("runner.feedback.missingJustification"));
    if (!explanation && rawSummary) {
      summary = rawSummary;
    }
  }

  const style = verdictStyle[verdict];
  const references = feedback.official_references ?? [];

  return (
    <section className="flex flex-col gap-6 motion-safe:animate-[rise-in_200ms_var(--ease-out)]" aria-label={title}>
      <div className={cn("flex items-start gap-3.5 border-l-[3px] py-1 pl-4", style.rail)} role="status">
        <span aria-hidden="true" className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", style.badge)}>
          <style.Icon size={15} strokeWidth={2.4} />
        </span>
        <div className="min-w-0">
          <p className={cn("text-lg font-semibold leading-snug", style.title)}>{title}</p>
          {summary ? <p className="mt-1 text-[0.9375rem] leading-relaxed text-fg-muted">{summary}</p> : null}
        </div>
      </div>

      {explanation ? <Explanation text={explanation} t={t} /> : null}

      {bits.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase">{t("runner.resolution.details")}</h3>
          <ul className="flex flex-col gap-1 text-sm text-fg-muted">
            {bits.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-fg-subtle" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {references.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase">{t("runner.resolution.references")}</h3>
          <ReferencesList references={references} ariaLabel={t("runner.labels.referencesOfficialAria")} t={t} />
        </div>
      ) : null}
    </section>
  );
}
