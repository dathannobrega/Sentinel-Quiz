"use client";

import { useCallback, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useOptionalI18n } from "@/lib/i18n/provider";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Accessible, non-blocking confirmation (never window.confirm). The safe choice gets initial focus. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const i18n = useOptionalI18n();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      title={title}
      description={message}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel} autoFocus>
            {cancelLabel ?? i18n?.t("system.confirm.cancel") ?? "Cancel"}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} busy={busy} onClick={onConfirm}>
            {confirmLabel ?? i18n?.t("system.confirm.confirm") ?? "Confirm"}
          </Button>
        </>
      }
    />
  );
}

/**
 * Promise-based confirm helper:
 *   const { confirm, dialog } = useConfirm();
 *   if (await confirm({ title, message })) { ... }
 *   return <>{dialog}...</>;
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...options, resolve });
      }),
    []
  );

  const close = useCallback(
    (value: boolean) => {
      state?.resolve(value);
      setState(null);
    },
    [state]
  );

  const dialog = (
    <ConfirmDialog
      open={!!state}
      title={state?.title ?? ""}
      message={state?.message ?? ""}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      tone={state?.tone}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { confirm, dialog };
}
