"use client";

import { memo, useEffect, useRef, type MouseEvent } from "react";

import type { ReaderBlock } from "@/features/reading/lib/blocks";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

interface ReadAlongBlockProps {
  block: ReaderBlock;
  /** 1-based position of this block in the section (for the accessible label). */
  position: number;
  total: number;
  active: boolean;
  /** Index of the word being spoken (-1 = none). Only meaningful when active. */
  currentWordIndex: number;
  /** Scroll the block into view when it becomes active. */
  follow: boolean;
  onActivate: () => void;
  /** Word click (listen mode): seek to that word. */
  onWordClick?: (tokenIndex: number) => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One paragraph with every word wrapped in `<span data-word data-i>`; the current word is marked
 * with background + underline (not color alone). Word clicks are delegated from the paragraph.
 */
export const ReadAlongBlock = memo(function ReadAlongBlock({
  block,
  position,
  total,
  active,
  currentWordIndex,
  follow,
  onActivate,
  onWordClick
}: ReadAlongBlockProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !follow || !ref.current) {
      return;
    }
    ref.current.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [active, follow]);

  function handleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-word]") : null;
    if (!active) {
      onActivate();
    }
    if (target && onWordClick) {
      const index = Number(target.dataset.i);
      if (Number.isInteger(index)) {
        onWordClick(index);
      }
    }
  }

  // Interleave the original gaps (whitespace, punctuation) with the word spans.
  const nodes: Array<string | { index: number; text: string }> = [];
  let cursor = 0;
  block.tokens.forEach((token, index) => {
    if (token.start > cursor) {
      nodes.push(block.text.slice(cursor, token.start));
    }
    nodes.push({ index, text: token.text });
    cursor = token.end;
  });
  if (cursor < block.text.length) {
    nodes.push(block.text.slice(cursor));
  }

  const words = nodes.map((node, i) => {
    if (typeof node === "string") {
      return node;
    }
    const isCurrent = active && node.index === currentWordIndex;
    return (
      <span
        key={i}
        data-word=""
        data-i={node.index}
        title={onWordClick ? t("reading.reader.wordSeek", { word: node.text }) : undefined}
        className={cn(
          "rounded-sm transition-colors duration-100",
          onWordClick && "cursor-pointer hover:bg-surface-muted",
          isCurrent && "bg-primary-soft underline decoration-primary decoration-2 underline-offset-4"
        )}
        aria-current={isCurrent ? "true" : undefined}
      >
        {node.text}
      </span>
    );
  });

  const textClass = "font-serif text-[1.0625rem] leading-[1.75] text-fg";

  return (
    <div
      ref={ref}
      role="group"
      aria-label={t("reading.reader.block", { index: position, total })}
      aria-current={active ? "true" : undefined}
      onClick={handleClick}
      className={cn(
        "-mx-3 rounded-md border-l-2 px-3 py-1 transition-colors duration-150 sm:-mx-4 sm:px-4",
        active ? "border-primary bg-surface" : "border-transparent hover:border-line-strong"
      )}
    >
      {active ? <span className="sr-only">{t("reading.reader.blockActive")}</span> : null}
      {block.label ? (
        <aside className="rounded-md bg-surface-muted px-4 py-3" aria-label={block.label}>
          <p className="mb-1 text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{block.label}</p>
          <p className={cn(textClass, "leading-[1.7]")}>{words}</p>
        </aside>
      ) : (
        <p className={textClass}>{words}</p>
      )}
    </div>
  );
});
