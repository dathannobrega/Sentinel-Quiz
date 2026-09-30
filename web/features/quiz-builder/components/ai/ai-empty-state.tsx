"use client";

import { Button } from "@/components/ui/button";
import { AiButton } from "@/features/quiz-builder/components/ai/ai-shared";
import { DatabaseIcon, PlusIcon, SparklesIcon } from "@/features/quiz-builder/components/icons";
import { useI18n } from "@/lib/i18n";

/**
 * Empty state of a new quiz: AI generation is the first suggestion, writing a question or
 * importing from the bank stay one click away. Works without AI (the button then opens the
 * dialog on the bank draw, which explains why AI is unavailable).
 */
export function AiEmptyState({ onGenerate, onAdd, onBank, aiAvailable }: { onGenerate: () => void; onAdd: () => void; onBank: () => void; aiAvailable: boolean }) {
  const { t } = useI18n();
  return (
    <section
      aria-labelledby="ai-empty-title"
      className="ai-surface relative isolate flex flex-col items-center gap-5 overflow-hidden rounded-lg border border-line px-6 py-12 text-center motion-safe:animate-[rise-in_280ms_var(--ease-out)] sm:px-10"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -top-16 left-1/2 -z-10 size-64 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <span aria-hidden="true" className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary shadow-raised">
        <SparklesIcon size={28} className="motion-safe:animate-[pop-in_600ms_var(--ease-out)]" />
      </span>
      <div className="flex max-w-xl flex-col gap-2">
        <h2 id="ai-empty-title" className="text-xl font-semibold tracking-[-0.01em] text-fg">
          {t("quizAi.empty.title")}
        </h2>
        <p className="text-[0.9375rem] leading-relaxed text-fg-muted">{aiAvailable ? t("quizAi.empty.message") : t("quizAi.empty.messageNoAi")}</p>
      </div>
      <ol className="grid w-full max-w-2xl gap-2 text-left text-[0.8125rem] sm:grid-cols-3">
        {(["describe", "review", "present"] as const).map((step, index) => (
          <li key={step} className="flex items-start gap-2 rounded-md border border-line bg-surface/70 px-3 py-2.5">
            <span className="nums grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[0.6875rem] font-semibold text-on-primary">{index + 1}</span>
            <span className="leading-snug text-fg">{t(`quizAi.empty.steps.${step}`)}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <AiButton onClick={onGenerate} className="h-11 px-5">
          <SparklesIcon />
          {t("quizAi.entry.generate")}
        </AiButton>
        <Button variant="secondary" onClick={onAdd}>
          <PlusIcon />
          {t("quizAi.empty.add")}
        </Button>
        <Button variant="ghost" onClick={onBank}>
          <DatabaseIcon />
          {t("quizAi.empty.bank")}
        </Button>
      </div>
    </section>
  );
}
