import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils/cn";

interface StatePageProps {
  /** Short code or label above the title (e.g. "404"). */
  code?: ReactNode;
  title: ReactNode;
  message: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  role?: "alert";
  titleRef?: Ref<HTMLHeadingElement>;
  className?: string;
}

/** Full-page state (error, not found): says what happened and where to go next. */
export function StatePage({ code, title, message, detail, actions, role, titleRef, className }: StatePageProps) {
  return (
    <main className={cn("mx-auto flex min-h-[70dvh] w-full max-w-xl flex-col justify-center gap-4 px-4 py-16 sm:px-6", className)}>
      <div role={role} className="flex flex-col gap-3">
        {code ? <p className="font-mono text-sm text-fg-subtle">{code}</p> : null}
        <h1 ref={titleRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-fg outline-none">
          {title}
        </h1>
        <p className="text-[0.9375rem] leading-relaxed text-fg-muted">{message}</p>
        {detail ? <p className="font-mono text-xs text-fg-subtle">{detail}</p> : null}
      </div>
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </main>
  );
}
