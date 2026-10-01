/**
 * Ordering items (T05, CONTRATO-INCREMENTO-5.md §3–§6). Participants receive the items shuffled
 * (never in the correct order) and send every id in the order they chose.
 */
import type { PublicOption } from "@/features/quiz-live/lib/protocol";

/** Moves one entry to `to` (clamped); returns a new array. Out-of-range sources return a copy. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from < 0 || from >= list.length) {
    return next;
  }
  const target = Math.min(list.length - 1, Math.max(0, to));
  if (target === from) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved as T);
  return next;
}

export interface OrderingSlot {
  /** 0-based slot. */
  slot: number;
  /** The option that belongs in this slot. */
  correct: PublicOption | null;
  /** What the person put in this slot (null when they did not answer). */
  mine: PublicOption | null;
  /** null when there is nothing to compare. */
  hit: boolean | null;
  /** Share of the room with the right item in this slot (null when unknown). */
  pct: number | null;
}

/**
 * The correct order slot by slot, next to the person's own placement. Empty when the correct order
 * is hidden on the device (`show_correct_on_device` off → `correct_order_ids` is empty).
 */
export function orderingSlots(
  options: readonly PublicOption[],
  correctIds: readonly string[],
  myOrder: readonly string[] | null | undefined,
  slotPct: ReadonlyArray<number | null> = []
): OrderingSlot[] {
  const byId = new Map(options.map((option) => [option.id, option]));
  return correctIds.map((id, slot) => {
    const mineId = myOrder?.[slot] ?? null;
    return {
      slot,
      correct: byId.get(id) ?? null,
      mine: mineId ? (byId.get(mineId) ?? null) : null,
      hit: mineId ? mineId === id : null,
      pct: slotPct[slot] ?? null
    };
  });
}

/** Options in the order of `ids` (unknown ids are skipped; missing options are appended). */
export function optionsInOrder(options: readonly PublicOption[], ids: readonly string[] | null | undefined): PublicOption[] {
  if (!ids?.length) {
    return [...options].sort((a, b) => a.index - b.index);
  }
  const byId = new Map(options.map((option) => [option.id, option]));
  const ordered = ids.map((id) => byId.get(id)).filter((option): option is PublicOption => Boolean(option));
  const rest = [...options].sort((a, b) => a.index - b.index).filter((option) => !ids.includes(option.id));
  return [...ordered, ...rest];
}
