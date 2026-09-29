import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  /** Emphasized stats get the larger numeral; use for the one number the view is about. */
  emphasis?: boolean;
  className?: string;
}

/** One labelled value inside a StatList (<dl>). No box: the list provides alignment and dividers. */
export function Stat({ label, value, meta, emphasis = false, className }: StatProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <dt className="text-[0.8125rem] text-fg-muted">{label}</dt>
      <dd className={cn("font-semibold tracking-tight text-fg", emphasis ? "text-3xl" : "text-xl")}>{value}</dd>
      {meta ? <dd className="text-xs text-fg-muted">{meta}</dd> : null}
    </div>
  );
}

/** Row of related numbers: responsive grid with a hairline above; no per-number boxes. */
export function StatList({ className, ...props }: HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      {...props}
      className={cn("grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-4 sm:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]", className)}
    />
  );
}
