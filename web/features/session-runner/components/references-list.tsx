"use client";

import { formatPedagogicalReference, type Translate } from "@/features/session-runner/lib/runner-utils";
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
    <ul className={className ? `sq-list ${className}` : "sq-list"} aria-label={ariaLabel}>
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
          <li key={`${reference.label}-${index}`} className="sq-list-item">
            <div className="sq-list-title">{formatPedagogicalReference(reference)}</div>
            {href ? (
              // New tab: keeps the running session (and its timer) intact.
              <a href={href} className="sq-text-link" target="_blank" rel="noopener noreferrer">
                {t("runner.labels.openExcerpt")}
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
