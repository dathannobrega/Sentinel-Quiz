import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type HeadingLevel = 2 | 3;

interface SectionHeadingProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: HeadingLevel;
  id?: string;
  className?: string;
}

/** Title row shared by Section and Panel: title + optional one-line description + trailing actions. */
export function SectionHeading({ title, description, actions, level = 2, id, className }: SectionHeadingProps) {
  if (!title && !description && !actions) {
    return null;
  }
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 flex-1">
        {title ? (
          <Heading id={id} className={cn("font-semibold text-fg", level === 2 ? "text-base" : "text-[0.9375rem]")}>
            {title}
          </Heading>
        ) : null}
        {description ? <p className="mt-0.5 max-w-prose text-[0.8125rem] leading-snug text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: HeadingLevel;
}

/**
 * Unboxed content group: hierarchy comes from type and spacing, not from a container.
 * Use this by default; reach for Panel only when a region needs a surface of its own.
 */
export function Section({ title, description, actions, level, className, children, ...props }: SectionProps) {
  return (
    <section {...props} className={cn("flex flex-col gap-4", className)}>
      <SectionHeading title={title} description={description} actions={actions} level={level} />
      {children}
    </section>
  );
}

interface PanelProps extends SectionProps {
  /** "default" = bordered surface; "muted" = tinted, borderless (secondary context). */
  tone?: "default" | "muted";
  padding?: "md" | "lg";
}

/** Bordered surface for regions that really are a unit (a form, a tool, a result block). */
export function Panel({ title, description, actions, level, tone = "default", padding = "md", className, children, ...props }: PanelProps) {
  return (
    <section
      {...props}
      className={cn(
        "flex flex-col gap-4 rounded-lg",
        tone === "default" ? "border border-line bg-surface" : "bg-surface-muted",
        padding === "md" ? "p-4 sm:p-5" : "p-5 sm:p-7",
        className
      )}
    >
      <SectionHeading title={title} description={description} actions={actions} level={level} />
      {children}
    </section>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small context line above the title (e.g. certification). Not decoration: must carry information. */
  context?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** The page's single h1. */
export function PageHeader({ title, description, context, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0 flex-1">
        {context ? <p className="mb-1 text-[0.8125rem] font-medium text-fg-muted">{context}</p> : null}
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg sm:text-[1.75rem] sm:leading-tight">{title}</h1>
        {description ? <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

interface PageProps extends HTMLAttributes<HTMLElement> {
  width?: "narrow" | "reading" | "default" | "wide";
}

const widths = {
  narrow: "max-w-xl",
  reading: "max-w-reading",
  default: "max-w-page",
  wide: "max-w-[88rem]"
};

/** Page container: the <main> landmark with the product's gutters and vertical rhythm. */
export function Page({ width = "default", className, children, ...props }: PageProps) {
  return (
    <main
      {...props}
      className={cn("mx-auto flex w-full flex-col gap-8 px-4 pt-6 pb-16 sm:px-6 lg:px-10 lg:pt-10", widths[width], className)}
    >
      {children}
    </main>
  );
}

/** Horizontal rule between sibling groups when spacing alone is not enough. */
export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line", className)} />;
}
