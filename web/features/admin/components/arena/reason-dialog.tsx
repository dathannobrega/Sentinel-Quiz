"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { REASON_MAX_LENGTH, REASON_MIN_LENGTH } from "@/lib/api/live-admin";
import { useI18n } from "@/lib/i18n";

/**
 * Confirmation with a written reason (forced end, destructive moderation). `required` enforces the
 * backend rule (≥ 5 characters, ≤ 500); the error stays inside the dialog until it is fixed.
 * The note resets on every opening.
 */
export function ReasonDialog({
  open,
  title,
  message,
  label,
  hint,
  required,
  confirmLabel,
  tone = "danger",
  busy,
  error,
  onConfirm,
  onCancel,
  children
}: {
  open: boolean;
  title: string;
  message: string;
  label: string;
  hint: string;
  required: boolean;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy: boolean;
  /** Server error (e.g. case_closed), shown above the actions. */
  error?: string | null;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const baseId = useId();
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNote("");
      setTouched(false);
    }
  }

  const length = note.trim().length;
  const invalid = required ? length < REASON_MIN_LENGTH : false;
  const formId = `${baseId}-form`;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (invalid || busy) {
      return;
    }
    onConfirm(note.trim());
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      dismissible={!busy}
      role="alertdialog"
      title={title}
      description={message}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
            {t("admin.arena.common.cancel")}
          </Button>
          <Button type="submit" form={formId} variant={tone === "danger" ? "danger" : "primary"} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {children}
        <Field
          label={label}
          htmlFor={`${baseId}-note`}
          hint={hint}
          hintMode="inline"
          error={touched && invalid ? t("admin.arena.common.reasonRequired") : null}
        >
          <Textarea
            id={`${baseId}-note`}
            value={note}
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            required={required}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {error ? <Alert tone="danger" role="alert" message={error} /> : null}
      </form>
    </Dialog>
  );
}
