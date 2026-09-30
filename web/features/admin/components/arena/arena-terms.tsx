"use client";

import { useId, useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Panel, Section } from "@/components/ui/section";
import { toLiveAdminErrorCode } from "@/lib/api/live-admin";
import { useI18n } from "@/lib/i18n";
import { useAddLiveTerm, useDeleteLiveTerm, useLiveAdminTerms } from "@/lib/query/live-admin-hooks";
import { formatDate } from "@/lib/utils/format";
import type { LiveModerationTerm, LiveTermKind, LiveTermMatch, LiveTermScope } from "@/types/api";

const MATCHES: LiveTermMatch[] = ["token", "substring"];
const KINDS: LiveTermKind[] = ["block", "allow"];
const SCOPES: LiveTermScope[] = ["all", "content", "names"];
export const TERM_MIN = 2;
export const TERM_MAX = 64;

/** Same rule as the server (after trimming; the server also folds accents and case). */
export function isTermValid(term: string): boolean {
  const length = Array.from(term.trim()).length;
  return length >= TERM_MIN && length <= TERM_MAX;
}

/** RF-1107: admin-managed filter terms. Reviewers read the list; only admins add or delete. */
export function ArenaTerms({ canAdmin }: { canAdmin: boolean }) {
  const { t, locale } = useI18n();
  const baseId = useId();
  const terms = useLiveAdminTerms({ enabled: true });
  const addTerm = useAddLiveTerm();
  const deleteTerm = useDeleteLiveTerm();
  const [term, setTerm] = useState("");
  const [match, setMatch] = useState<LiveTermMatch>("token");
  const [kind, setKind] = useState<LiveTermKind>("block");
  const [scope, setScope] = useState<LiveTermScope>("all");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const [removing, setRemoving] = useState<LiveModerationTerm | null>(null);

  const termInvalid = !isTermValid(term);

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (termInvalid) {
      return;
    }
    setNotice(null);
    addTerm.mutate(
      { term, match, kind, scope, note },
      {
        onSuccess: (created) => {
          setNotice({ tone: "success", message: t("admin.arena.terms.added", { term: created?.term ?? term.trim() }) });
          setTerm("");
          setNote("");
          setTouched(false);
        },
        onError: (error) => setNotice({ tone: "danger", message: t(`admin.arena.errors.${toLiveAdminErrorCode(error)}`) })
      }
    );
  }

  function confirmDelete() {
    if (!removing) {
      return;
    }
    deleteTerm.mutate(removing.id, {
      onSuccess: () => {
        setRemoving(null);
        setNotice({ tone: "success", message: t("admin.arena.terms.deleted") });
      },
      onError: (error) => {
        setRemoving(null);
        setNotice({ tone: "danger", message: t(`admin.arena.errors.${toLiveAdminErrorCode(error)}`) });
      }
    });
  }

  const items = terms.data ?? [];

  return (
    <Section title={t("admin.arena.terms.title")} description={t("admin.arena.terms.subtitle")}>
      {notice ? <Alert tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"} message={notice.message} /> : null}

      {canAdmin ? (
        <Panel title={t("admin.arena.terms.addTitle")} level={3}>
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.4fr)_repeat(3,minmax(9rem,1fr))]">
            <Field
              label={t("admin.arena.terms.termLabel")}
              htmlFor={`${baseId}-term`}
              hint={t("admin.arena.terms.termHint")}
              hintMode="inline"
              error={touched && termInvalid ? t("admin.arena.terms.termInvalid") : null}
            >
              <Input id={`${baseId}-term`} value={term} maxLength={TERM_MAX} autoComplete="off" onChange={(event) => setTerm(event.target.value)} disabled={addTerm.isPending} />
            </Field>
            <Field label={t("admin.arena.terms.matchLabel")} htmlFor={`${baseId}-match`} hintMode="none">
              <Select id={`${baseId}-match`} value={match} onChange={(event) => setMatch(event.target.value as LiveTermMatch)} disabled={addTerm.isPending}>
                {MATCHES.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.arena.terms.match.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("admin.arena.terms.kindLabel")} htmlFor={`${baseId}-kind`} hintMode="none">
              <Select id={`${baseId}-kind`} value={kind} onChange={(event) => setKind(event.target.value as LiveTermKind)} disabled={addTerm.isPending}>
                {KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.arena.terms.kind.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("admin.arena.terms.scopeLabel")} htmlFor={`${baseId}-scope`} hintMode="none">
              <Select id={`${baseId}-scope`} value={scope} onChange={(event) => setScope(event.target.value as LiveTermScope)} disabled={addTerm.isPending}>
                {SCOPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.arena.terms.scope.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label={t("admin.arena.terms.noteLabel")} htmlFor={`${baseId}-note`} hintMode="none">
                <Input id={`${baseId}-note`} value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} disabled={addTerm.isPending} />
              </Field>
            </div>
            <div className="flex items-end">
              <Button type="submit" busy={addTerm.isPending} busyLabel={t("admin.arena.terms.adding")} className="w-full sm:w-auto">
                {t("admin.arena.terms.submit")}
              </Button>
            </div>
          </form>
        </Panel>
      ) : (
        <Alert tone="neutral" message={t("admin.arena.terms.adminOnly")} />
      )}

      {terms.isPending ? (
        <p role="status" className="text-sm text-fg-muted">
          {t("admin.arena.common.loading")}
        </p>
      ) : terms.isError ? (
        <QueryErrorBanner error={terms.error} title={t("admin.arena.terms.loadError")} onRetry={() => void terms.refetch()} retrying={terms.isFetching} />
      ) : items.length ? (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <caption className="sr-only">{t("admin.arena.terms.caption")}</caption>
            <thead>
              <tr className="border-b border-line text-xs text-fg-muted">
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.terms.columns.term")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.terms.columns.match")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.terms.columns.kind")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.terms.columns.scope")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.terms.columns.note")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("admin.arena.terms.columns.created")}</th>
                {canAdmin ? (
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">{t("admin.arena.terms.columns.actions")}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-3 font-mono text-fg [overflow-wrap:anywhere]">{item.term}</td>
                  <td className="py-2 pr-3 text-fg-muted">{t(`admin.arena.terms.match.${item.match}`)}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={item.kind === "block" ? "danger" : "success"}>{t(`admin.arena.terms.kind.${item.kind}`)}</Badge>
                  </td>
                  <td className="py-2 pr-3 text-fg-muted">{t(`admin.arena.terms.scope.${item.scope}`)}</td>
                  <td className="py-2 pr-3 text-fg-muted">{item.note || t("admin.arena.common.none")}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-fg-muted">{formatDate(item.created_at, locale)}</td>
                  {canAdmin ? (
                    <td className="py-1.5 text-right">
                      <Button size="sm" variant="ghost" aria-label={t("admin.arena.terms.deleteLabel", { term: item.term })} onClick={() => setRemoving(item)}>
                        {t("admin.arena.terms.delete")}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState size="compact" description={t("admin.arena.terms.empty")} />
      )}

      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        busy={deleteTerm.isPending}
        title={t("admin.arena.terms.deleteTitle", { term: removing?.term ?? "" })}
        message={t("admin.arena.terms.deleteText")}
        confirmLabel={t("admin.arena.terms.delete")}
        cancelLabel={t("admin.arena.common.cancel")}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmDelete}
      />
    </Section>
  );
}
