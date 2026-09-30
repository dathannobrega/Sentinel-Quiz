"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Section } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";
import { useLiveAdminAudit } from "@/lib/query/live-admin-hooks";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { LiveAuditEvent } from "@/types/api";

const KNOWN_ACTIONS = new Set([
  "force_end",
  "case_dismiss",
  "case_approve",
  "case_remove_item",
  "case_end_session",
  "case_block_quiz",
  "term_added",
  "term_removed",
  "quiz_unblocked",
  "report_view",
  "export_csv",
  "admin_report_view",
  "participant_erased",
  "participant_claimed",
  "retention_anonymize",
  "retention_purge",
  "retention_manual_run"
]);

/** RF-1110 (admin): audited actions, filterable by session id. */
export function ArenaAudit() {
  const { t, locale } = useI18n();
  const baseId = useId();
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState("");
  const audit = useLiveAdminAudit(sessionId, { enabled: true });

  function apply(event: FormEvent) {
    event.preventDefault();
    setSessionId(draft.trim());
  }

  function actor(event: LiveAuditEvent): string {
    if (event.actor_email) {
      return event.actor_email;
    }
    return event.actor_kind === "participant" ? t("admin.arena.audit.actorParticipant") : t("admin.arena.audit.actorSystem");
  }

  const items = audit.data ?? [];

  return (
    <Section title={t("admin.arena.audit.title")} description={t("admin.arena.audit.subtitle")}>
      <form onSubmit={apply} className="flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-0 flex-1 basis-64">
          <Field label={t("admin.arena.audit.sessionFilter")} htmlFor={`${baseId}-session`} hint={t("admin.arena.audit.sessionFilterHint")} hintMode="inline">
            <Input id={`${baseId}-session`} value={draft} maxLength={36} spellCheck={false} autoComplete="off" className="font-mono" onChange={(event) => setDraft(event.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2 pb-6">
          <Button type="submit" variant="secondary">
            {t("admin.arena.audit.apply")}
          </Button>
          {sessionId ? (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft("");
                setSessionId("");
              }}
            >
              {t("admin.arena.audit.clear")}
            </Button>
          ) : null}
        </div>
      </form>

      {audit.isPending ? (
        <p role="status" className="text-sm text-fg-muted">
          {t("admin.arena.common.loading")}
        </p>
      ) : audit.isError ? (
        <QueryErrorBanner error={audit.error} title={t("admin.arena.audit.loadError")} onRetry={() => void audit.refetch()} retrying={audit.isFetching} />
      ) : items.length ? (
        <div className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", audit.isFetching && "opacity-70")} aria-busy={audit.isFetching || undefined}>
          <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
            <caption className="sr-only">{t("admin.arena.audit.caption")}</caption>
            <thead>
              <tr className="border-b border-line text-xs text-fg-muted">
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.audit.columns.when")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.audit.columns.action")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.audit.columns.actor")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.audit.columns.session")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.audit.columns.target")}</th>
                <th scope="col" className="py-2 font-medium">{t("admin.arena.audit.columns.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((event) => (
                <tr key={String(event.id)} className="border-b border-line align-top last:border-b-0">
                  <td className="py-2 pr-3 whitespace-nowrap text-fg-muted">{formatDateTime(event.created_at, locale)}</td>
                  <td className="py-2 pr-3 text-fg">
                    {KNOWN_ACTIONS.has(event.action) ? t(`admin.arena.audit.actions.${event.action}`) : <span className="font-mono">{event.action}</span>}
                  </td>
                  <td className="py-2 pr-3 text-fg-muted [overflow-wrap:anywhere]">{actor(event)}</td>
                  <td className="py-2 pr-3">
                    {event.session_id ? (
                      <button
                        type="button"
                        className="focus-ring rounded-sm font-mono text-xs text-primary underline-offset-2 hover:underline"
                        onClick={() => {
                          setDraft(event.session_id ?? "");
                          setSessionId(event.session_id ?? "");
                        }}
                        title={event.session_id}
                      >
                        {event.session_id.slice(0, 8)}
                      </button>
                    ) : (
                      <span className="text-fg-subtle">{t("admin.arena.common.none")}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-fg-muted [overflow-wrap:anywhere]">{event.target ?? t("admin.arena.common.none")}</td>
                  <td className="py-2 text-fg [overflow-wrap:anywhere]">{event.reason ?? t("admin.arena.common.none")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState size="compact" description={t("admin.arena.audit.empty")} />
      )}
    </Section>
  );
}
