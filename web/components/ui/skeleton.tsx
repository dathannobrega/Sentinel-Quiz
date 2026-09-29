import { cn } from "@/lib/utils/cn";

interface SkeletonProps {
  height?: number;
  className?: string;
}

/** Loading placeholder with the shape of the content it stands in for. */
export function Skeleton({ height = 20, className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      style={{ height }}
      className={cn("w-full rounded-md bg-surface-muted motion-safe:animate-[pulse-soft_1.6s_ease-in-out_infinite]", className)}
    />
  );
}
