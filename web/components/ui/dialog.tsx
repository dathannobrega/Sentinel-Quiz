"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { XIcon } from "@/components/ui/icons";
import { useOptionalI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils/cn";

type Placement = "center" | "right" | "left";

interface DialogProps {
  open: boolean;
  /** Esc, backdrop click and the close button all call this (unless `dismissible` is false). */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Visually hide the title (it still labels the dialog). */
  hideTitle?: boolean;
  placement?: Placement;
  dismissible?: boolean;
  showCloseButton?: boolean;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
  role?: "dialog" | "alertdialog";
}

const placements: Record<Placement, string> = {
  center:
    "m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] rounded-lg motion-safe:animate-[rise-in_160ms_var(--ease-out)]",
  right:
    "my-0 mr-0 ml-auto h-dvh max-h-dvh w-[min(26rem,100vw)] rounded-none border-y-0 border-r-0 motion-safe:animate-[slide-in-right_200ms_var(--ease-out)]",
  left:
    "my-0 ml-0 mr-auto h-dvh max-h-dvh w-[min(20rem,88vw)] rounded-none border-y-0 border-l-0 motion-safe:animate-[slide-in-left_200ms_var(--ease-out)]"
};

/**
 * Native <dialog> opened with showModal(): focus trap, Esc, inert background and top-layer for free.
 * Focus returns to the element that opened it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  hideTitle = false,
  placement = "center",
  dismissible = true,
  showCloseButton = placement !== "center",
  footer,
  className,
  children,
  role = "dialog"
}: DialogProps) {
  const i18n = useOptionalI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      returnFocusRef.current?.focus?.();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "flex-col overflow-hidden border border-line bg-surface-raised p-0 text-fg shadow-overlay open:flex backdrop:bg-overlay",
        placements[placement],
        className
      )}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) {
          onClose();
        }
      }}
      onClick={(event) => {
        // A click on the <dialog> box itself (not its content) is a click on the backdrop.
        if (dismissible && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={cn("flex items-start gap-3 px-5 pt-5", hideTitle && "sr-only")}>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-lg font-semibold leading-snug text-fg">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        {showCloseButton && !hideTitle ? (
          <button
            type="button"
            className="focus-ring -mr-2 -mt-1 inline-grid size-9 place-items-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
            aria-label={i18n?.t("system.dialog.close") ?? "Close"}
            onClick={onClose}
            disabled={!dismissible}
          >
            <XIcon size={18} />
          </button>
        ) : null}
      </div>
      {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">{children}</div> : <div className="pb-5" />}
      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-raised px-5 py-4">{footer}</div>
      ) : null}
    </dialog>
  );
}
