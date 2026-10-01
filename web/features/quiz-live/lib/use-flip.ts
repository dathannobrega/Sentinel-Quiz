"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/** Starts `node` at its old offset, then lets a transform transition carry it home (DOM only). */
function playFlip(node: HTMLElement, dx: number, dy: number, durationMs: number): void {
  node.style.transition = "none";
  node.style.transform = `translate(${dx}px, ${dy}px)`;
  // Force the start frame before the transition.
  void node.offsetWidth;
  node.style.transition = `transform ${durationMs}ms var(--lq-ease-emph, cubic-bezier(0.05, 0.7, 0.1, 1))`;
  node.style.transform = "";
}

/**
 * FLIP reorder animation with plain CSS transforms (no layout engine): after each render where
 * `order` changed, every registered element starts at its previous position and glides to the new
 * one. `disabled` (reduced motion / calm mode) makes moves instant.
 */
export function useFlip(order: readonly string[], { disabled = false, durationMs = 520 }: { disabled?: boolean; durationMs?: number } = {}) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, DOMRect>());
  const signature = order.join("|");

  const register = useCallback(
    (key: string) => (node: HTMLElement | null) => {
      if (node) {
        nodes.current.set(key, node);
      } else {
        nodes.current.delete(key);
      }
    },
    []
  );

  useLayoutEffect(() => {
    const previous = rects.current;
    const next = new Map<string, DOMRect>();
    for (const [key, node] of nodes.current) {
      const rect = node.getBoundingClientRect();
      next.set(key, rect);
      const before = previous.get(key);
      if (disabled || !before) {
        continue;
      }
      const dx = before.left - rect.left;
      const dy = before.top - rect.top;
      if (!dx && !dy) {
        continue;
      }
      playFlip(node, dx, dy, durationMs);
    }
    rects.current = next;
  }, [signature, disabled, durationMs]);

  return register;
}
