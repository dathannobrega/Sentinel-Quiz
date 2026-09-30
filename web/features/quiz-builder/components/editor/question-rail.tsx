"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { AlertIcon, ChevronDownIcon, ChevronUpIcon, GripIcon } from "@/components/ui/icons";
import { AiBadge, AiButton } from "@/features/quiz-builder/components/ai/ai-shared";
import { CopyIcon, DatabaseIcon, ItemTypeIcon, PlusIcon, SparklesIcon, TrashIcon } from "@/features/quiz-builder/components/icons";
import { isBankItem } from "@/features/quiz-builder/lib/items";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveItem } from "@/types/api";

interface QuestionRailProps {
  items: LiveItem[];
  selectedId: string | null;
  issueCounts: Record<string, number>;
  maxItems: number;
  readOnly: boolean;
  busy: boolean;
  onSelect: (itemId: string) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
  onAddFromBank: () => void;
  /** "Gerar com IA" (Incremento 2); hidden when undefined. */
  onGenerateAi?: () => void;
  onDuplicate: (item: LiveItem) => void;
  onDelete: (item: LiveItem) => void;
}

/**
 * Ordered list of questions. Reorder by drag-and-drop (pointer) or with the ↑/↓ buttons
 * (keyboard, WCAG 2.5.7); each move is announced in a polite live region.
 */
export function QuestionRail({
  items,
  selectedId,
  issueCounts,
  maxItems,
  readOnly,
  busy,
  onSelect,
  onMove,
  onAdd,
  onAddFromBank,
  onGenerateAi,
  onDuplicate,
  onDelete
}: QuestionRailProps) {
  const { t } = useI18n();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pendingFocus = useRef<{ id: string; direction: "up" | "down" } | null>(null);
  const full = items.length >= maxItems;

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) {
      return;
    }
    const index = items.findIndex((item) => item.id === target.id);
    if (index === -1) {
      return;
    }
    pendingFocus.current = null;
    const preferred = buttonRefs.current[`${target.id}:${target.direction}`];
    const fallback = buttonRefs.current[`${target.id}:${target.direction === "up" ? "down" : "up"}`];
    (preferred && !preferred.disabled ? preferred : fallback)?.focus();
  }, [items]);

  function move(from: number, to: number, direction?: "up" | "down") {
    if (to < 0 || to >= items.length || from === to) {
      return;
    }
    const moved = items[from];
    if (moved && direction) {
      pendingFocus.current = { id: moved.id, direction };
    }
    onMove(from, to);
    setAnnouncement(t("quizBuilder.rail.moved", { position: to + 1, total: items.length }));
  }

  function onDragStart(event: DragEvent<HTMLLIElement>, index: number) {
    setDragIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  function onDragOver(event: DragEvent<HTMLLIElement>, index: number) {
    if (dragIndex === null) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDropIndex(after ? index + 1 : index);
  }

  function onDrop(event: DragEvent<HTMLLIElement | HTMLOListElement>) {
    event.preventDefault();
    if (dragIndex !== null && dropIndex !== null) {
      const to = dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
      move(dragIndex, to);
    }
    setDragIndex(null);
    setDropIndex(null);
  }

  return (
    <nav aria-label={t("quizBuilder.rail.title")} className="flex min-h-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[0.8125rem] font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("quizBuilder.rail.title")}</h2>
        <span className="nums text-xs text-fg-subtle">{t("quizBuilder.rail.count", { count: items.length, max: maxItems })}</span>
      </div>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-[0.8125rem] leading-snug text-fg-muted">
          {t("quizBuilder.rail.empty")}
        </p>
      ) : (
        <ol
          aria-label={t("quizBuilder.rail.listLabel")}
          className="flex flex-col gap-1.5"
          onDragOver={(event) => {
            if (dragIndex !== null) event.preventDefault();
          }}
          onDrop={onDrop}
        >
          {items.map((item, index) => {
            const selected = item.id === selectedId;
            const issues = issueCounts[item.id] ?? 0;
            const prompt = item.prompt.trim() || (item.item_type === "leaderboard" ? t("quizBuilder.types.leaderboard.name") : "");
            return (
              <li
                key={item.id}
                draggable={!readOnly && !busy}
                onDragStart={(event) => onDragStart(event, index)}
                onDragOver={(event) => onDragOver(event, index)}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                onDrop={onDrop}
                className={cn(
                  "group/item relative rounded-md border transition-[border-color,background-color,box-shadow,opacity] duration-150",
                  selected ? "border-primary bg-surface shadow-raised" : "border-line bg-surface hover:border-line-strong",
                  dragIndex === index && "opacity-50",
                  dropIndex === index && dragIndex !== null && "before:absolute before:inset-x-0 before:-top-1 before:h-0.5 before:rounded-full before:bg-primary",
                  dropIndex === index + 1 &&
                    index === items.length - 1 &&
                    dragIndex !== null &&
                    "after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-primary"
                )}
              >
                <div className="flex items-stretch">
                  {!readOnly ? (
                    <span aria-hidden="true" className="flex w-5 shrink-0 cursor-grab items-center justify-center text-fg-subtle active:cursor-grabbing">
                      <GripIcon size={14} />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    aria-label={`${t("quizBuilder.rail.itemLabel", { position: index + 1, type: t(`quizBuilder.types.${item.item_type}.name`) })}. ${prompt || t("quizBuilder.rail.noPrompt")}`}
                    onClick={() => onSelect(item.id)}
                    className={cn("focus-ring flex min-w-0 flex-1 items-start gap-2 rounded-md py-2 pr-2 text-left", readOnly && "pl-2")}
                  >
                    <span className="nums mt-px w-5 shrink-0 text-right font-mono text-xs font-semibold text-fg-muted">{index + 1}</span>
                    <ItemTypeIcon type={item.item_type} className={cn("mt-0.5 shrink-0", selected ? "text-primary" : "text-fg-subtle")} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className={cn("line-clamp-2 text-[0.8125rem] leading-snug", prompt ? "text-fg" : "text-fg-subtle italic")}>
                        {prompt || t("quizBuilder.rail.noPrompt")}
                      </span>
                      {isBankItem(item) || item.source_kind === "ai" || item.review_state === "needs_review" || issues > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {item.source_kind === "ai" ? <AiBadge compact /> : null}
                          {isBankItem(item) ? (
                            <span className="inline-flex items-center gap-1 rounded-sm bg-primary-soft px-1.5 text-[0.6875rem] font-medium text-primary">
                              <DatabaseIcon size={11} />
                              {t("quizBuilder.rail.bank")}
                              {item.domain ? <span className="max-w-[7rem] truncate font-normal">· {item.domain}</span> : null}
                            </span>
                          ) : null}
                          {item.review_state === "needs_review" ? (
                            <span className="inline-flex items-center gap-1 rounded-sm bg-warning-soft px-1.5 text-[0.6875rem] font-medium text-warning">
                              <AlertIcon size={11} />
                              {t("quizBuilder.rail.review")}
                            </span>
                          ) : null}
                          {issues > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-sm bg-danger-soft px-1.5 text-[0.6875rem] font-medium text-danger">
                              <AlertIcon size={11} />
                              {t("quizBuilder.rail.issues", { count: issues })}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </div>
                {!readOnly ? (
                  <div
                    className={cn(
                      "flex items-center justify-end gap-0.5 border-t border-line px-1 py-0.5",
                      selected ? "flex" : "hidden group-focus-within/item:flex group-hover/item:flex"
                    )}
                  >
                    <RailIconButton
                      ref={(node) => {
                        buttonRefs.current[`${item.id}:up`] = node;
                      }}
                      label={t("quizBuilder.rail.moveUp", { position: index + 1 })}
                      disabled={busy || index === 0}
                      onClick={() => move(index, index - 1, "up")}
                    >
                      <ChevronUpIcon size={14} />
                    </RailIconButton>
                    <RailIconButton
                      ref={(node) => {
                        buttonRefs.current[`${item.id}:down`] = node;
                      }}
                      label={t("quizBuilder.rail.moveDown", { position: index + 1 })}
                      disabled={busy || index === items.length - 1}
                      onClick={() => move(index, index + 1, "down")}
                    >
                      <ChevronDownIcon size={14} />
                    </RailIconButton>
                    {!isBankItem(item) ? (
                      <RailIconButton
                        label={t("quizBuilder.rail.duplicate", { position: index + 1 })}
                        disabled={busy || full}
                        onClick={() => onDuplicate(item)}
                      >
                        <CopyIcon size={14} />
                      </RailIconButton>
                    ) : null}
                    <RailIconButton
                      label={t("quizBuilder.rail.delete", { position: index + 1 })}
                      disabled={busy}
                      danger
                      onClick={() => onDelete(item)}
                    >
                      <TrashIcon size={14} />
                    </RailIconButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {!readOnly ? (
        <div className="flex flex-col gap-2 pt-1">
          <Button onClick={onAdd} disabled={full}>
            <PlusIcon />
            {t("quizBuilder.rail.add")}
          </Button>
          <Button variant="secondary" onClick={onAddFromBank} disabled={full}>
            <DatabaseIcon />
            {t("quizBuilder.rail.fromBank")}
          </Button>
          {onGenerateAi ? (
            <AiButton onClick={onGenerateAi} disabled={full}>
              <SparklesIcon />
              {t("quizAi.entry.generate")}
            </AiButton>
          ) : null}
          {full ? <p className="text-xs text-fg-muted">{t("quizBuilder.rail.limitReached", { max: maxItems })}</p> : null}
        </div>
      ) : null}
    </nav>
  );
}

interface RailIconButtonProps {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}

function RailIconButton({ label, disabled, danger, onClick, children, ref }: RailIconButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "focus-ring grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent",
        danger && "hover:bg-danger-soft hover:text-danger"
      )}
    >
      {children}
    </button>
  );
}
