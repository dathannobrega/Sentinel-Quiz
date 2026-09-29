"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

interface RollbackDialogProps {
  target: { versionId: number; versionNumber: number } | null;
  questionId: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/** Replaces window.prompt: asks for the rollback reason in an accessible modal dialog. */
export function RollbackDialog({ target, questionId, busy, onConfirm, onCancel }: RollbackDialogProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (target) {
      setReason(t("admin.rollback.defaultReason", { version: target.versionNumber }));
    }
  }, [target, t]);

  return (
    <Dialog
      open={!!target}
      onClose={onCancel}
      dismissible={!busy}
      showCloseButton={false}
      title={t("admin.rollback.title", { id: questionId })}
      description={t("admin.rollback.message", { id: questionId, version: target?.versionNumber ?? "-" })}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(reason);
        }}
      >
        <Field label={t("admin.rollback.reasonLabel")} htmlFor="admin-rollback-reason" hintMode="none">
          <Textarea id="admin-rollback-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {t("admin.rollback.cancel")}
          </Button>
          <Button type="submit" variant="danger" busy={busy}>
            {t("admin.rollback.confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
