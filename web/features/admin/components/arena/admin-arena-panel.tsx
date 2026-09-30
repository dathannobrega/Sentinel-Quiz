"use client";

import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";

import { ArenaAudit } from "@/features/admin/components/arena/arena-audit";
import { ArenaOverview } from "@/features/admin/components/arena/arena-overview";
import { ArenaQueue } from "@/features/admin/components/arena/arena-queue";
import { ArenaTerms } from "@/features/admin/components/arena/arena-terms";

/**
 * Sentinel Arena admin (PLANO §7.11, CONTRATO-INCREMENTO-4.md §5). Moderators (reviewer) see the
 * overview, work the queue and read the terms; admin-only actions and the audit tab are hidden
 * for them (the backend enforces the same rule with 403).
 */
export function AdminArenaPanel({ canReview, canAdmin }: { canReview: boolean; canAdmin: boolean }) {
  const { t } = useI18n();
  if (!canReview) {
    return <Alert tone="warning" title={t("admin.arena.title")} message={t("admin.arena.forbidden")} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold text-fg">{t("admin.arena.title")}</h2>
        <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{t("admin.arena.subtitle")}</p>
      </header>
      {!canAdmin ? <Alert tone="neutral" message={t("admin.arena.reviewerNote")} /> : null}
      <Tabs
        ariaLabel={t("admin.arena.tabs.label")}
        items={[
          { id: "arena-overview", label: t("admin.arena.tabs.overview"), content: <ArenaOverview canAdmin={canAdmin} /> },
          { id: "arena-queue", label: t("admin.arena.tabs.queue"), content: <ArenaQueue canAdmin={canAdmin} /> },
          { id: "arena-terms", label: t("admin.arena.tabs.terms"), content: <ArenaTerms canAdmin={canAdmin} /> },
          ...(canAdmin ? [{ id: "arena-audit", label: t("admin.arena.tabs.audit"), content: <ArenaAudit /> }] : [])
        ]}
      />
    </div>
  );
}
