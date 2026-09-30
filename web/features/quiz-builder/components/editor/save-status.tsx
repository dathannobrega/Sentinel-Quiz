"use client";

import { AlertIcon, CircleCheckIcon, CircleXIcon, SpinnerIcon } from "@/components/ui/icons";
import type { AutosaveStatus } from "@/features/quiz-builder/lib/autosave";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

/** "Salvo / Salvando… / Erro" pill. Announced politely; icon + text, never colour alone. */
export function SaveStatus({ status, busy, onRetry }: { status: AutosaveStatus; busy: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  const effective: AutosaveStatus = busy && (status === "idle" || status === "saved") ? "saving" : status;
  const label = t(`quizBuilder.editor.status.${effective}`);
  const tone =
    effective === "error" || effective === "conflict" || effective === "blocked"
      ? "text-danger"
      : effective === "pending" || effective === "saving"
        ? "text-fg-muted"
        : "text-success";
  return (
    <div className="flex items-center gap-2">
      <p role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 text-[0.8125rem] font-medium whitespace-nowrap", tone)}>
        {effective === "saving" ? <SpinnerIcon size={14} /> : null}
        {effective === "pending" ? <span aria-hidden="true" className="size-2 rounded-full bg-current motion-safe:animate-[pulse-soft_1.2s_ease-in-out_infinite]" /> : null}
        {effective === "saved" || effective === "idle" ? <CircleCheckIcon size={14} /> : null}
        {effective === "blocked" ? <AlertIcon size={14} /> : null}
        {effective === "error" || effective === "conflict" ? <CircleXIcon size={14} /> : null}
        <span className="max-w-[14rem] truncate">{label}</span>
      </p>
      {effective === "error" ? (
        <button type="button" onClick={onRetry} className="focus-ring rounded-sm text-[0.8125rem] font-medium text-primary underline underline-offset-2">
          {t("quizBuilder.editor.status.retry")}
        </button>
      ) : null}
    </div>
  );
}
