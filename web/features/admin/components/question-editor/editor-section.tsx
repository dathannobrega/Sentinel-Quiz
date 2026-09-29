import type { ReactNode } from "react";

import { SectionHeading } from "@/components/ui/section";
import { cn } from "@/lib/utils/cn";

interface EditorSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** One group of the question form: hairline above, h3 title, no surrounding box. */
export function EditorSection({ id, title, subtitle, actions, className, children }: EditorSectionProps) {
  return (
    <section className={cn("flex flex-col gap-4 border-t border-line pt-6", className)} aria-labelledby={id}>
      <SectionHeading id={id} level={3} title={title} description={subtitle} actions={actions} />
      {children}
    </section>
  );
}

/** Responsive field grid for the editor (1 → 2 → 3 columns as the container grows). */
export const editorGrid = "grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3";
export const editorGridSplit = "grid gap-4 @xl:grid-cols-2";
