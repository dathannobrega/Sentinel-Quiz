import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface MetricCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
}

export function MetricCard({ className, label, value, meta, ...props }: MetricCardProps) {
  return (
    <div {...props} className={cn("sq-metric-card", className)}>
      <span className="sq-muted">{label}</span>
      <strong>{value}</strong>
      {meta ? <span className="sq-list-meta">{meta}</span> : null}
    </div>
  );
}
