"use client";

import { useEffect, useId, useRef, useState } from "react";

import { InfoIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils/cn";

/**
 * Toggletip: a real button that reveals an explanation (click/Enter/Space), closes on Esc or
 * outside click. The text is linked with aria-describedby, so it is not hover-only.
 */
export function InfoTip({ label, children, className }: { label: string; children: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="focus-ring inline-grid size-5 place-items-center rounded-full text-fg-muted hover:text-fg aria-expanded:text-primary print:hidden"
      >
        <InfoIcon size={14} />
      </button>
      <span
        id={id}
        role="note"
        hidden={!open}
        className="absolute top-full left-1/2 z-20 mt-2 w-72 -translate-x-1/2 rounded-md border border-line bg-surface-raised p-3 text-[0.8125rem] leading-relaxed font-normal text-fg shadow-overlay motion-safe:animate-[rise-in_140ms_var(--ease-out)]"
      >
        {children}
      </span>
    </span>
  );
}
