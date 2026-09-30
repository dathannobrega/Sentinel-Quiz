"use client";

import { useMemo, useRef, useState } from "react";
import { m } from "motion/react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon } from "@/components/ui/icons";
import { DraftCard } from "@/features/quiz-builder/components/ai/ai-draft-card";
import { aiErrorMessage } from "@/features/quiz-builder/components/ai/ai-shared";
import { PlusIcon } from "@/features/quiz-builder/components/icons";
import { buildApplyRequest, initialSelection, isDraftBlocked, selectValidDrafts, toggleDraft, type DraftSelection } from "@/features/quiz-builder/lib/ai";
import { useI18n } from "@/lib/i18n";
import type { AiDraftItem } from "@/types/api";

interface DraftReviewProps {
  drafts: AiDraftItem[];
  summary: { requested: number; produced: number; blocked: number; warnings: number };
  /** Questions that still fit in the quiz. */
  capacity: number;
  criticEnabled: boolean;
  /** Applies the drafts; resolves with the ids of the created quiz items. */
  onApply: (indexes: number[], force: boolean) => Promise<string[]>;
  onOpenItem: (itemId: string) => void;
}

/**
 * Human review of the generated drafts: nothing enters the quiz without an explicit choice. Valid
 * drafts start selected; drafts with an `error` issue need "Adicionar mesmo assim" (force).
 */
export function DraftReview({ drafts, summary, capacity, criticEnabled, onApply, onOpenItem }: DraftReviewProps) {
  const { t, locale } = useI18n();
  const [selection, setSelection] = useState<DraftSelection>(() => initialSelection(drafts, capacity));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ count: number; firstId: string | null } | null>(null);
  const successRef = useRef<HTMLDivElement>(null);

  const request = useMemo(() => buildApplyRequest(drafts, selection), [drafts, selection]);
  const count = request.indexes.length;
  const pendingValid = drafts.filter((draft) => !draft.applied && !isDraftBlocked(draft));
  const full = count >= capacity;

  async function apply() {
    if (!count) return;
    setApplying(true);
    setError(null);
    try {
      const created = await onApply(request.indexes, request.force);
      setApplied({ count: request.indexes.length, firstId: created[0] ?? null });
      setSelection({ selected: new Set(), forced: new Set() });
      window.requestAnimationFrame(() => successRef.current?.focus());
    } catch (caught) {
      setError(aiErrorMessage(t, caught, locale));
    } finally {
      setApplying(false);
    }
  }

  if (!drafts.length) {
    return <Alert tone="warning" title={t("quizAi.review.emptyTitle")} message={t("quizAi.review.empty")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="nums text-[0.8125rem] text-fg-muted">
          {t("quizAi.review.summary", {
            produced: summary.produced,
            requested: summary.requested,
            blocked: summary.blocked,
            warnings: summary.warnings
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!pendingValid.length || capacity <= 0}
            onClick={() => setSelection({ selected: new Set(selectValidDrafts(drafts, capacity)), forced: new Set() })}
          >
            {t("quizAi.review.selectAllValid")}
          </Button>
          <Button size="sm" variant="ghost" disabled={!selection.selected.size} onClick={() => setSelection({ selected: new Set(), forced: new Set() })}>
            {t("quizAi.review.clear")}
          </Button>
        </div>
      </div>

      {applied ? (
        <div ref={successRef} tabIndex={-1} className="focus-ring rounded-md">
          <Alert
            tone="success"
            title={t("quizAi.review.appliedTitle", { count: applied.count })}
            message={t("quizAi.review.appliedMessage")}
            action={
              applied.firstId ? (
                <Button size="sm" variant="secondary" onClick={() => applied.firstId && onOpenItem(applied.firstId)}>
                  {t("quizAi.review.goToEditor")}
                  <ArrowRightIcon />
                </Button>
              ) : null
            }
          />
        </div>
      ) : null}

      <ul aria-label={t("quizAi.review.listLabel")} className="flex flex-col gap-3">
        {drafts.map((draft, index) => (
          <m.li
            key={draft.index}
            initial={{ y: 12 }}
            animate={{ y: 0 }}
            transition={{ type: "spring", visualDuration: 0.4, bounce: 0.15, delay: Math.min(index * 0.05, 0.4) }}
          >
            <DraftCard
              draft={draft}
              number={index + 1}
              selected={selection.selected.has(draft.index)}
              forced={selection.forced.has(draft.index)}
              selectionDisabled={full}
              criticEnabled={criticEnabled}
              onToggle={() => setSelection((current) => toggleDraft(current, draft, { capacity }))}
              onForce={() => setSelection((current) => toggleDraft(current, draft, { force: true, capacity }))}
            />
          </m.li>
        ))}
      </ul>

      <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-col gap-2 border-t border-line bg-surface-raised/95 px-5 py-3 backdrop-blur">
        {error ? <Alert tone="danger" role="alert" message={error} /> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="nums text-[0.8125rem] text-fg-muted">
            {t("quizAi.review.selected", { count })}
            {" · "}
            {capacity > 0 ? t("quizAi.review.capacity", { count: capacity }) : t("quizAi.review.full")}
          </p>
          <Button onClick={() => void apply()} disabled={!count} busy={applying}>
            <PlusIcon />
            {count === 1 ? t("quizAi.review.addOne") : count ? t("quizAi.review.add", { count }) : t("quizAi.review.addNone")}
          </Button>
        </div>
      </div>
    </div>
  );
}
