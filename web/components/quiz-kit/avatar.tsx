import { memo } from "react";

import { cn } from "@/lib/utils/cn";

/** FNV-1a 32-bit hash. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Background/ink pairs with ≥ 4.5:1 contrast; no red/green (reserved for correctness). */
const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["#1e2a78", "#9fb4ff"],
  ["#3b1d6e", "#d8b4fe"],
  ["#0b4a5c", "#7ee8fa"],
  ["#5b2a06", "#fbc98a"],
  ["#5a1348", "#f9a8e8"],
  ["#1f2937", "#e5e7eb"],
  ["#123a6b", "#a5d8ff"],
  ["#4a2d0b", "#fde68a"]
];

export interface AvatarPattern {
  background: string;
  ink: string;
  /** 5×5 cells, mirrored horizontally. */
  cells: boolean[];
  /** Accent cell drawn as a dot (adds variety without colour). */
  dot: number;
}

export function avatarPattern(seed: string): AvatarPattern {
  const hash = hashSeed(seed || "?");
  const random = seededRandom(hash);
  const [background, ink] = PALETTE[hash % PALETTE.length];
  const cells: boolean[] = new Array(25).fill(false);
  let filled = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const on = random() > 0.5;
      cells[row * 5 + col] = on;
      cells[row * 5 + (4 - col)] = on;
      filled += on ? 1 : 0;
    }
  }
  if (filled < 3) {
    cells[12] = true;
    cells[7] = true;
    cells[17] = true;
  }
  const empty = cells.map((on, index) => (on ? -1 : index)).filter((index) => index >= 0);
  const dot = empty.length ? empty[Math.floor(random() * empty.length)] : -1;
  return { background, ink, cells, dot };
}

/**
 * Deterministic geometric avatar (identicon) from `avatar_seed`. Decorative by default; pass
 * `label` when it stands alone.
 */
export const Avatar = memo(function Avatar({ seed, size = 40, className, label }: { seed: string; size?: number; className?: string; label?: string }) {
  const pattern = avatarPattern(seed);
  const cell = 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect width="100" height="100" rx="26" fill={pattern.background} />
      <g transform="translate(10 10)" fill={pattern.ink}>
        {pattern.cells.map((on, index) =>
          on ? <rect key={index} x={(index % 5) * cell} y={Math.floor(index / 5) * cell} width={cell} height={cell} rx="3.5" /> : null
        )}
        {pattern.dot >= 0 ? (
          <circle cx={(pattern.dot % 5) * cell + cell / 2} cy={Math.floor(pattern.dot / 5) * cell + cell / 2} r={cell / 4} />
        ) : null}
      </g>
    </svg>
  );
});
