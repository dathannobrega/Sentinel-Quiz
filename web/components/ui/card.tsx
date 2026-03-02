import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function Card({ className, title, subtitle, actions, children, style, ...props }: CardProps) {
  return (
    <section
      {...props}
      className={cn("sq-card", className)}
      style={{
        border: "1px solid var(--sq-border)",
        borderRadius: "var(--sq-radius-lg)",
        background: "var(--sq-surface)",
        boxShadow: "var(--sq-shadow-md)",
        padding: "var(--sq-space-6)",
        ...style
      }}
    >
      {(title || subtitle || actions) && (
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "var(--sq-space-4)",
            marginBottom: "var(--sq-space-5)"
          }}
        >
          <div>
            {title ? <h2 className="sq-section-title">{title}</h2> : null}
            {subtitle ? <p className="sq-section-subtitle">{subtitle}</p> : null}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
