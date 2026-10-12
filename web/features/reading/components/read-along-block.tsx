"use client";

import { memo, useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

import type { ReaderBlock } from "@/features/reading/lib/blocks";
import type { TokenRange } from "@/features/reading/lib/sentences";
import { STATUS_CLASS, STATUS_LABEL_KEY } from "@/features/reading/lib/word-status";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { ReadingAssessedWord } from "@/types/api";

/** Touch long-press that opens the glossary. */
export const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

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
  /** Opens the glossary for a word (double click, long press, or a plain click with `glossaryTap`). */
  onWordGlossary?: (tokenIndex: number) => void;
  /** "Tap to translate": a plain click opens the glossary instead of seeking. */
  glossaryTap?: boolean;
  /** Drill: tokens of the current sentence. */
  highlight?: TokenRange | null;
  /** Drill: assessed words of the last attempt, by token index. */
  marks?: ReadonlyMap<number, ReadingAssessedWord> | null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wordIndexOf(target: EventTarget | null): number | null {
  const element = target instanceof Element ? target.closest<HTMLElement>("[data-word]") : null;
  if (!element) {
    return null;
  }
  const index = Number(element.dataset.i);
  return Number.isInteger(index) ? index : null;
}

/**
 * One paragraph with every word wrapped in `<span data-word data-i>`; the current word is marked
 * with background + underline (not color alone). Word clicks are delegated from the paragraph.
 * With "tap to translate" on, the words of the active block are keyboard-focusable buttons.
 */
export const ReadAlongBlock = memo(function ReadAlongBlock({
  block,
  position,
  total,
  active,
  currentWordIndex,
  follow,
  onActivate,
  onWordClick,
  onWordGlossary,
  glossaryTap = false,
  highlight = null,
  marks = null
}: ReadAlongBlockProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!active || !follow || !ref.current) {
      return;
    }
    ref.current.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [active, follow]);

  useEffect(
    () => () => {
      if (pressRef.current) {
        globalThis.clearTimeout(pressRef.current.timer);
      }
    },
    []
  );

  const cancelPress = () => {
    if (pressRef.current) {
      globalThis.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };

  function handleClick(event: MouseEvent<HTMLElement>) {
    if (suppressClickRef.current) {
      // The long press already opened the glossary.
      suppressClickRef.current = false;
      return;
    }
    const index = wordIndexOf(event.target);
    if (!active) {
      onActivate();
    }
    if (index === null) {
      return;
    }
    if (glossaryTap && onWordGlossary) {
      onWordGlossary(index);
    } else if (onWordClick) {
      onWordClick(index);
    }
  }

  function handleDoubleClick(event: MouseEvent<HTMLElement>) {
    const index = wordIndexOf(event.target);
    if (index !== null && onWordGlossary && !glossaryTap) {
      event.preventDefault();
      onWordGlossary(index);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch" || !onWordGlossary) {
      return;
    }
    const index = wordIndexOf(event.target);
    if (index === null) {
      return;
    }
    cancelPress();
    const timer = globalThis.setTimeout(() => {
      pressRef.current = null;
      suppressClickRef.current = true;
      if (!active) {
        onActivate();
      }
      onWordGlossary(index);
    }, LONG_PRESS_MS);
    pressRef.current = { timer, x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const press = pressRef.current;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_MOVE_TOLERANCE) {
      cancelPress();
    }
  }

  function handleWordKey(event: KeyboardEvent<HTMLElement>, index: number) {
    if ((event.key === "Enter" || event.key === " ") && onWordGlossary) {
      event.preventDefault();
      event.stopPropagation();
      onWordGlossary(index);
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

  const focusableWords = active && glossaryTap && Boolean(onWordGlossary);
  const inHighlight = (index: number) => Boolean(highlight && highlight.last >= highlight.first && index >= highlight.first && index <= highlight.last);

  const words = nodes.map((node, i) => {
    if (typeof node === "string") {
      return node;
    }
    const isCurrent = active && node.index === currentWordIndex;
    const mark = active ? marks?.get(node.index) : undefined;
    const status = mark?.status;
    const titleText = mark && status && status !== "ok"
      ? t(STATUS_LABEL_KEY[status])
      : glossaryTap && onWordGlossary
        ? t("reading.glossary.openFor", { word: node.text })
        : onWordClick
          ? t("reading.reader.wordSeek", { word: node.text })
          : undefined;
    return (
      <span
        key={i}
        data-word=""
        data-i={node.index}
        title={titleText}
        role={focusableWords ? "button" : undefined}
        tabIndex={focusableWords ? 0 : undefined}
        aria-label={focusableWords ? t("reading.glossary.openFor", { word: node.text }) : undefined}
        onKeyDown={focusableWords ? (event) => handleWordKey(event, node.index) : undefined}
        className={cn(
          "rounded-sm transition-colors duration-100",
          (onWordClick || onWordGlossary) && "cursor-pointer hover:bg-surface-muted",
          focusableWords && "focus-ring",
          inHighlight(node.index) && "bg-surface-muted",
          status && STATUS_CLASS[status],
          isCurrent && "bg-primary-soft underline decoration-primary decoration-2 underline-offset-4"
        )}
        aria-current={isCurrent ? "true" : undefined}
      >
        {node.text}
        {status && status !== "ok" ? <span className="sr-only"> ({t(STATUS_LABEL_KEY[status])})</span> : null}
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
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
        }
      }}
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
