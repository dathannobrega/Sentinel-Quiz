"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n";

interface RollbackDialogProps {
  target: { versionId: number; versionNumber: number } | null;
  questionId: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/** Replaces window.prompt: asks for the rollback reason in an accessible modal <dialog>. */
export function RollbackDialog({ target, questionId, busy, onConfirm, onCancel }: RollbackDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();
  const [reason, setReason] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (target) {
      setReason(t("admin.rollback.defaultReason", { version: target.versionNumber }));
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          dialog.setAttribute("open", "");
        }
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [target, t]);

  return (
    <dialog
      ref={dialogRef}
      className="sq-dialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onCancel();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(reason);
        }}
      >
        <h2 id={titleId} className="sq-dialog__title">
          {t("admin.rollback.title", { id: questionId })}
        </h2>
        <p id={messageId} className="sq-dialog__message">
          {t("admin.rollback.message", { id: questionId, version: target?.versionNumber ?? "-" })}
        </p>
        <Field label={t("admin.rollback.reasonLabel")} htmlFor="admin-rollback-reason" hintMode="none">
          <textarea
            id="admin-rollback-reason"
            className="sq-textarea"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="sq-actions" style={{ marginTop: "var(--sq-space-4)" }}>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {t("admin.rollback.cancel")}
          </Button>
          <Button type="submit" variant="danger" busy={busy}>
            {t("admin.rollback.confirm")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
