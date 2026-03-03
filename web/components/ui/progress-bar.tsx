import { cn } from "@/lib/utils/cn";

interface ProgressBarProps {
  value: number;
  className?: string;
}

export function ProgressBar({ value, className }: ProgressBarProps) {
  const clampedValue = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className={cn("sq-progress-track", className)} aria-hidden="true">
      <div className="sq-progress-fill" style={{ width: `${clampedValue}%` }} />
    </div>
  );
}
