"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { reportContent, toReportErrorCode } from "@/features/quiz-live/lib/live-fetch";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveReportReason } from "@/types/api/live";

export const REPORT_REASONS: readonly LiveReportReason[] = ["offensive", "spam", "cheating", "copyright", "privacy", "other"];
export const REPORT_NOTE_MAX = 500;

/**
 * RF-1104: the participant reports the session or the item on screen. Reason is required; the
 * optional note is capped at 500 characters (server rule). Success closes the dialog and the
 * caller shows a toast; errors (429 too_many_reports included) stay inside the dialog.
 */
export function ReportDialog({
  open,
  onClose,
  token,
  itemQi,
  defaultTarget = "item",
  onSent
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  /** The item on screen (0-based), or null when there is none (lobby, podium...). */
  itemQi: number | null;
  defaultTarget?: "item" | "session";
  onSent: () => void;
}) {
  const { t } = useI18n();
  const baseId = useId();
  const [target, setTarget] = useState<"item" | "session">(itemQi === null ? "session" : defaultTarget);
  const [reason, setReason] = useState<LiveReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonMissing, setReasonMissing] = useState(false);
  const firstReasonRef = useRef<HTMLInputElement>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Every opening starts clean, aimed at the item on screen when there is one (state adjusted
  // during render, React's pattern for resetting on a prop change).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTarget(itemQi === null ? "session" : defaultTarget);
      setReason(null);
      setNote("");
      setError(null);
      setReasonMissing(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason) {
      setReasonMissing(true);
      firstReasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim().slice(0, REPORT_NOTE_MAX);
      const aimAtItem = target === "item" && itemQi !== null;
      await reportContent(token, {
        target: aimAtItem ? "item" : "session",
        ...(aimAtItem ? { qi: itemQi } : {}),
        reason,
        ...(trimmed ? { note: trimmed } : {})
      });
      onSent();
    } catch (caught) {
      setError(t(`quizPlay.report.errors.${toReportErrorCode(caught)}`));
    } finally {
      setBusy(false);
    }
  }

  const formId = `${baseId}-form`;
  const reasonErrorId = `${baseId}-reason-error`;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      dismissible={!busy}
      title={t("quizPlay.report.title")}
      description={t("quizPlay.report.subtitle")}
      className="w-[min(30rem,calc(100vw-1.5rem))]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("quizPlay.report.cancel")}
          </Button>
          <Button type="submit" form={formId} variant="danger" busy={busy} busyLabel={t("quizPlay.report.submitting")}>
            {t("quizPlay.report.submit")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-5">
        {itemQi !== null ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizPlay.report.targetLabel")}</legend>
            {(["item", "session"] as const).map((value) => (
              <label key={value} className={radioRow(target === value)}>
                <input
                  type="radio"
                  name={`${baseId}-target`}
                  value={value}
                  checked={target === value}
                  onChange={() => setTarget(value)}
                  disabled={busy}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="text-fg">{value === "item" ? t("quizPlay.report.targetItem", { position: itemQi + 1 }) : t("quizPlay.report.targetSession")}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <fieldset className="flex flex-col gap-2" aria-describedby={reasonMissing ? reasonErrorId : undefined}>
          <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizPlay.report.reasonLabel")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {REPORT_REASONS.map((value, index) => (
              <label key={value} className={radioRow(reason === value)}>
                <input
                  ref={index === 0 ? firstReasonRef : undefined}
                  type="radio"
                  name={`${baseId}-reason`}
                  value={value}
                  checked={reason === value}
                  required
                  onChange={() => {
                    setReason(value);
                    setReasonMissing(false);
                  }}
                  disabled={busy}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="text-fg">{t(`quizPlay.report.reasons.${value}`)}</span>
              </label>
            ))}
          </div>
          {reasonMissing ? (
            <span id={reasonErrorId} role="alert" className="text-[0.8125rem] font-medium text-danger">
              {t("quizPlay.report.reasonRequired")}
            </span>
          ) : null}
        </fieldset>

        <Field label={t("quizPlay.report.noteLabel")} htmlFor={`${baseId}-note`} hint={t("quizPlay.report.noteHint")} hintMode="inline">
          <Textarea
            id={`${baseId}-note`}
            value={note}
            maxLength={REPORT_NOTE_MAX}
            rows={3}
            disabled={busy}
            onChange={(event) => setNote(event.target.value.slice(0, REPORT_NOTE_MAX))}
          />
        </Field>
        <p className="-mt-3 self-end font-mono text-xs text-fg-muted" aria-hidden="true">
          {t("quizPlay.report.noteCount", { count: note.length, max: REPORT_NOTE_MAX })}
        </p>

        {error ? <Alert tone="danger" role="alert" message={error} /> : null}
      </form>
    </Dialog>
  );
}

function radioRow(selected: boolean): string {
  return cn(
    "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
    selected ? "border-primary bg-primary-soft/40" : "border-line hover:border-line-strong"
  );
}
