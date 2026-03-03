"use client";

import { useState } from "react";
import type { DetailsHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type AccordionProps = HTMLAttributes<HTMLDivElement>;

interface AccordionItemProps extends DetailsHTMLAttributes<HTMLDetailsElement> {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  defaultOpen?: boolean;
}

export function Accordion({ className, ...props }: AccordionProps) {
  return <div {...props} className={cn("sq-accordion", className)} />;
}

export function AccordionItem({
  className,
  title,
  subtitle,
  meta,
  defaultOpen = false,
  children,
  ...props
}: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      {...props}
      className={cn("sq-accordion__item", className)}
      open={isOpen}
      onToggle={(event) => {
        setIsOpen(event.currentTarget.open);
        props.onToggle?.(event);
      }}
    >
      <summary className="sq-accordion__summary">
        <div>
          <div className="sq-list-title">{title}</div>
          {subtitle && <div className="sq-list-meta">{subtitle}</div>}
        </div>
        {meta && <div className="sq-chip-row">{meta}</div>}
      </summary>
      <div className="sq-accordion__content">{children}</div>
    </details>
  );
}