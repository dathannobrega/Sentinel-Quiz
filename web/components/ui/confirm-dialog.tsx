"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
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

/**
 * Accessible, non-blocking confirmation built on the native <dialog> element
 * (focus trap, Esc to cancel, backdrop). Never use window.confirm.
 */
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }
  }, [open]);

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
      <h2 id={titleId} className="sq-dialog__title">
        {title}
      </h2>
      <p id={messageId} className="sq-dialog__message">
        {message}
      </p>
      <div className="sq-actions">
        <Button variant="ghost" disabled={busy} onClick={onCancel} autoFocus>
          {cancelLabel ?? i18n?.t("system.confirm.cancel") ?? "Cancel"}
        </Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} busy={busy} onClick={onConfirm}>
          {confirmLabel ?? i18n?.t("system.confirm.confirm") ?? "Confirm"}
        </Button>
      </div>
    </dialog>
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
