import type { SVGProps } from "react";

import { optionLetter, optionShape, type OptionShapeName } from "@/features/quiz-live/lib/protocol";
import { cn } from "@/lib/utils/cn";

const PATHS: Record<OptionShapeName, string> = {
  triangle: "M12 3.2 21.5 20H2.5Z",
  diamond: "M12 2 22 12 12 22 2 12Z",
  circle: "M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Z",
  square: "M3.5 3.5h17v17h-17Z",
  pentagon: "M12 2.3 21.7 9.4 18 20.7H6L2.3 9.4Z",
  cross: "M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9Z"
};

/** Shape for an option index (▲◆●■⬟✚). Decorative: pair it with the letter and text. */
export function OptionShape({ index, className, ...props }: { index: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={cn("shrink-0", className)} {...props}>
      <path d={PATHS[optionShape(index)]} fill="currentColor" />
    </svg>
  );
}

/**
 * Shape + letter badge used on tiles, bars and legends: the shape is filled with the tile's text
 * colour and the letter is punched out in the tile colour, so both cues survive without colour.
 */
export function OptionBadge({ index, size = "md", className }: { index: number; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const sizes = {
    sm: "size-7 text-[0.625rem]",
    md: "size-10 text-xs",
    lg: "size-14 text-base",
    xl: "size-[clamp(3rem,7cqmin,6rem)] text-[clamp(0.875rem,2cqmin,1.75rem)]"
  } as const;
  const shape = optionShape(index);
  return (
    <span aria-hidden="true" className={cn("relative grid shrink-0 place-items-center", sizes[size], className)}>
      <OptionShape index={index} className="absolute inset-0 size-full" />
      <span
        className={cn(
          "relative font-lq-mono leading-none font-bold text-[var(--lq-badge-ink,var(--lq-tile))]",
          shape === "triangle" && "translate-y-[18%]"
        )}
      >
        {optionLetter(index)}
      </span>
    </span>
  );
}

/** High-contrast only: a per-option pattern strip (hidden in other themes). */
export function OptionPattern({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("lq-pattern pointer-events-none absolute", className)} />;
}
