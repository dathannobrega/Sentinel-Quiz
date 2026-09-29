import { cn } from "@/lib/utils/cn";

interface MeterProps {
  /** 0–100 */
  value: number;
  label?: string;
  /** "progress" = completion; "score" = a mastery/score reading colored by band. */
  kind?: "progress" | "score";
  className?: string;
}

function scoreTone(value: number): string {
  if (value >= 80) {
    return "bg-success";
  }
  if (value >= 65) {
    return "bg-warning";
  }
  return "bg-danger";
}

/**
 * Horizontal bar. Exposed as role="meter" when labelled; decorative (aria-hidden) otherwise, in which
 * case the value must be written next to it. Score color always accompanies a written percentage.
 */
export function Meter({ value, label, kind = "progress", className }: MeterProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const a11y = label
    ? { role: "meter" as const, "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": clamped }
    : { "aria-hidden": true as const };
  return (
    <div {...a11y} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-300 ease-out", kind === "score" ? scoreTone(clamped) : "bg-primary")}
        style={{ width: `${kind === "score" ? Math.max(clamped, 3) : clamped}%` }}
      />
    </div>
  );
}
