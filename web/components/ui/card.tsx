import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import { SectionHeader } from "@/components/ui/section-header";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function Card({ className, title, subtitle, actions, children, ...props }: CardProps) {
  return (
    <section {...props} className={cn("sq-card", className)}>
      <SectionHeader title={title} subtitle={subtitle} actions={actions} />
      {children}
    </section>
  );
}
