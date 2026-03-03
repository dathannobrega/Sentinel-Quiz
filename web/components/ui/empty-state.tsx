import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: "default" | "compact";
}

export function EmptyState({
  className,
  title,
  description,
  action,
  size = "default",
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      {...props}
      className={cn("sq-empty", size === "compact" && "sq-empty--compact", className)}
    >
      {title ? <div className="sq-list-title">{title}</div> : null}
      {description ? <div className={title ? "sq-list-meta" : undefined}>{description}</div> : null}
      {children}
      {action ? <div className="sq-actions">{action}</div> : null}
    </div>
  );
}
