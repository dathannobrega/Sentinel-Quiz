import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: "default" | "compact";
}

/** Empty result: says what is missing and, when possible, offers the next action. */
export function EmptyState({ className, title, description, action, size = "default", children, ...props }: EmptyStateProps) {
  return (
    <div
      {...props}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-md border border-dashed border-line-strong text-sm",
        size === "compact" ? "px-4 py-3" : "px-5 py-6",
        className
      )}
    >
      {title ? <p className="font-medium text-fg">{title}</p> : null}
      {description ? <div className="text-fg-muted">{description}</div> : null}
      {children}
      {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
