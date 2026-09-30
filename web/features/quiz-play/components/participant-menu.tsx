"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils/cn";

export interface ParticipantMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
}

/**
 * Discreet "⋯" menu in the participant header (WAI-ARIA menu button): Enter/Space/↓ open it and
 * focus the first item, ↑/↓/Home/End move, Esc/Tab close it and focus returns to the button.
 */
export function ParticipantMenu({ label, items, className }: { label: string; items: ParticipantMenuItem[]; className?: string }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function focusItem(index: number) {
    const count = items.length;
    itemRefs.current[((index % count) + count) % count]?.focus();
  }

  function openMenu(focusIndex = 0) {
    setOpen(true);
    // Items render on the next frame.
    requestAnimationFrame(() => focusItem(focusIndex));
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(items.length - 1);
    }
  }

  function onItemKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => (open ? close() : openMenu(0))}
        onKeyDown={onButtonKey}
        className="focus-ring grid size-11 place-items-center rounded-full text-lq-fg-muted transition-colors hover:bg-lq-surface-2 hover:text-lq-fg aria-expanded:bg-lq-surface-2 aria-expanded:text-lq-fg"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5" fill="currentColor">
          <circle cx="4" cy="10" r="1.8" />
          <circle cx="10" cy="10" r="1.8" />
          <circle cx="16" cy="10" r="1.8" />
        </svg>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-30 mt-1 flex min-w-48 flex-col rounded-[calc(var(--lq-radius)*0.6)] border border-lq-line bg-lq-surface p-1 shadow-[0_18px_40px_-16px_rgb(0_0_0/0.6)] motion-safe:animate-[rise-in_140ms_ease-out_both]"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onKeyDown={(event) => onItemKey(event, index)}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              className={cn(
                "focus-ring flex min-h-11 items-center rounded-[calc(var(--lq-radius)*0.4)] px-3 text-left text-sm font-semibold hover:bg-lq-surface-2",
                item.tone === "danger" ? "text-lq-danger" : "text-lq-fg"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
