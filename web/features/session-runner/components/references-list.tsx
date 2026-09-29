"use client";

import { BookIcon, ExternalIcon } from "@/components/ui/icons";
import { formatPedagogicalReference, type Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";
import { buildTheoryReaderHref } from "@/lib/utils/materials";
import type { PedagogicalReferenceItem } from "@/types/api";

interface ReferencesListProps {
  references: PedagogicalReferenceItem[];
  ariaLabel: string;
  t: Translate;
  className?: string;
}

export function ReferencesList({ references, ariaLabel, t, className }: ReferencesListProps) {
  if (!references.length) {
    return null;
  }
  return (
    <ul className={cn("flex flex-col gap-2", className)} aria-label={ariaLabel}>
      {references.map((reference, index) => {
        const href = reference.material_path
          ? buildTheoryReaderHref({
              material_path: reference.material_path,
              locator: reference.locator ?? undefined,
              page_start: reference.page_start,
              page_end: reference.page_end,
              source: reference.label,
              reference: reference.reference ?? undefined
            })
          : null;
        return (
          <li key={`${reference.label}-${index}`} className="flex items-start gap-2.5 text-[0.8125rem] leading-snug">
            <BookIcon className="mt-0.5 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1">
              <span className="text-fg">{formatPedagogicalReference(reference)}</span>
              {href ? (
                <>
                  {" "}
                  {/* New tab: keeps the running session (and its timer) intact. */}
                  <a
                    href={href}
                    className="focus-ring inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("runner.labels.openExcerpt")}
                    <ExternalIcon size={12} />
                  </a>
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
