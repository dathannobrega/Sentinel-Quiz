"use client";

import { CheckIcon } from "@/components/ui/icons";
import { OptionFace, optionRowClassName } from "@/features/session-runner/components/question-options";
import { useI18n } from "@/lib/i18n";

/**
 * Static, non-interactive preview of the product's signature (the answer-sheet bubbles and the
 * graded state). Content is the landing's own first FAQ entry, so nothing is invented.
 */
export function LandingPreview() {
  const { t, getMessage } = useI18n();
  const faq = getMessage<ReadonlyArray<readonly [string, string]>>("marketing.faq.items");
  const first = faq[0];
  if (!first) {
    return null;
  }
  const [question, answer] = first;
  const options = [
    { key: "A", text: t("marketing.preview.sample.yes"), state: null, selected: false },
    { key: "B", text: t("marketing.preview.sample.no"), state: "correct" as const, selected: true }
  ];

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5 shadow-raised sm:p-6">
        <p className="nums text-[0.8125rem] font-medium text-fg-muted">{t("runner.questionCard.title", { current: 1, total: 1 })}</p>
        <p className="font-serif text-[1.25rem] leading-snug text-fg">{question}</p>
        <div className="flex flex-col gap-2">
          {options.map((option) => (
            <div key={option.key} className={optionRowClassName(option.state, option.selected, false, true)}>
              <OptionFace
                optionKey={option.key}
                text={option.text}
                multiSelect={false}
                selected={option.selected}
                state={option.state}
                locked
                receded={!option.selected}
                t={t}
              />
            </div>
          ))}
        </div>
        <div className="flex items-start gap-3 border-l-[3px] border-success py-0.5 pl-3.5">
          <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success text-surface">
            <CheckIcon size={13} strokeWidth={2.4} />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-success">{t("runner.feedback.correct")}</p>
            <p className="mt-1 font-serif text-[0.9375rem] leading-relaxed text-fg">{answer}</p>
          </div>
        </div>
      </div>
      <figcaption className="text-xs text-fg-subtle">{t("marketing.preview.sample.caption")}</figcaption>
    </figure>
  );
}
