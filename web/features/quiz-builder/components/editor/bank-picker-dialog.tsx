"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CircleCheckIcon, CircleXIcon, InfoIcon } from "@/components/ui/icons";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchIcon, UsersIcon } from "@/features/quiz-builder/components/icons";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useBankFacets, useBankSearch } from "@/lib/query/live-hooks";
import { cn } from "@/lib/utils/cn";
import type { LiveBankItem, LiveFromBankResult } from "@/types/api";

const PAGE_SIZE = 20;

interface BankPickerDialogProps {
  open: boolean;
  onClose: () => void;
  /** Max questions that still fit in the quiz. */
  remaining: number;
  onAdd: (questionIds: string[]) => Promise<LiveFromBankResult>;
}

export function BankPickerDialog({ open, onClose, remaining, onAdd }: BankPickerDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("quizBuilder.bank.title")}
      description={t("quizBuilder.bank.description")}
      className="h-[min(52rem,calc(100dvh-2rem))] w-[min(60rem,calc(100vw-2rem))]"
      showCloseButton
    >
      {open ? <BankPickerBody onClose={onClose} remaining={remaining} onAdd={onAdd} /> : null}
    </Dialog>
  );
}

function difficultyLabel(t: (key: string) => string, value: string): string {
  const key = `quizBuilder.bank.difficulties.${value}`;
  const label = t(key);
  return label === key ? value : label;
}

function useReasonLabel() {
  const { t } = useI18n();
  return (reason: string) => {
    const key = `quizBuilder.bank.reasons.${reason}`;
    const label = t(key);
    return label === key ? reason : label;
  };
}

function BankPickerBody({ onClose, remaining, onAdd }: Omit<BankPickerDialogProps, "open">) {
  const { t } = useI18n();
  const baseId = useId();
  const reasonLabel = useReasonLabel();
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [certification, setCertification] = useState("");
  const [domain, setDomain] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [onlyGuestEligible, setOnlyGuestEligible] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Map<string, LiveBankItem>>(new Map());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<LiveFromBankResult["rejected"]>([]);
  const [addedCount, setAddedCount] = useState<number | null>(null);

  const facets = useBankFacets();
  const search = useBankSearch({
    q: deferredQ,
    certification: certification || undefined,
    domain: domain || undefined,
    difficulty: difficulty || undefined,
    onlyGuestEligible,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  });

  const domains = useMemo(
    () => (facets.data?.domains ?? []).filter((entry) => !certification || entry.certification === certification),
    [facets.data, certification]
  );
  const total = search.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = search.data?.items ?? [];

  function toggle(item: LiveBankItem) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.question_id)) {
        next.delete(item.question_id);
      } else if (next.size < remaining) {
        next.set(item.question_id, item);
      }
      return next;
    });
  }

  async function add() {
    if (!selected.size) return;
    setAdding(true);
    setError(null);
    setRejected([]);
    try {
      const ids = Array.from(selected.keys());
      const result = await onAdd(ids);
      const added = ids.length - result.rejected.length;
      setAddedCount(added);
      setSelected(new Map());
      if (!result.rejected.length) {
        onClose();
      } else {
        setRejected(result.rejected);
      }
    } catch (caught) {
      setError(readErrorMessage(caught, t("quizBuilder.library.actionError")));
    } finally {
      setAdding(false);
    }
  }

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(0);
    };
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${baseId}-q`} className="text-[0.8125rem] font-medium text-fg">
            {t("quizBuilder.bank.search")}
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
            <Input
              id={`${baseId}-q`}
              type="search"
              value={q}
              className="pl-9"
              placeholder={t("quizBuilder.bank.searchPlaceholder")}
              onChange={(event) => resetPage(setQ)(event.target.value)}
            />
          </div>
        </div>
        <FilterSelect
          id={`${baseId}-cert`}
          label={t("quizBuilder.bank.certification")}
          value={certification}
          onChange={(value) => {
            setCertification(value);
            setDomain("");
            setPage(0);
          }}
          options={(facets.data?.certifications ?? []).map((entry) => ({ value: entry.id, label: `${entry.label} (${entry.count})` }))}
        />
        <FilterSelect
          id={`${baseId}-domain`}
          label={t("quizBuilder.bank.domain")}
          value={domain}
          onChange={resetPage(setDomain)}
          options={domains.map((entry) => ({ value: entry.domain, label: `${entry.domain} (${entry.count})` }))}
        />
        <FilterSelect
          id={`${baseId}-difficulty`}
          label={t("quizBuilder.bank.difficulty")}
          value={difficulty}
          onChange={resetPage(setDifficulty)}
          options={(["Easy", "Medium", "Hard"] as const).map((value) => ({ value, label: t(`quizBuilder.bank.difficulties.${value}`) }))}
        />
      </div>
      <Checkbox
        id={`${baseId}-guest`}
        checked={onlyGuestEligible}
        onChange={(event) => resetPage(setOnlyGuestEligible)(event.target.checked)}
        label={t("quizBuilder.bank.onlyGuest")}
        description={t("quizBuilder.bank.onlyGuestHint")}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-[0.8125rem] text-fg-muted">
        <span aria-live="polite">{search.data ? t("quizBuilder.bank.results", { count: total }) : " "}</span>
        <span className="font-medium text-fg">{t("quizBuilder.bank.selected", { count: selected.size })}</span>
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" aria-busy={search.isFetching || undefined}>
        {search.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} height={76} />
            ))}
          </div>
        ) : search.isError ? (
          <Alert tone="danger" role="alert" title={t("quizBuilder.bank.loadError")} message={readErrorMessage(search.error, "")} />
        ) : items.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-sm text-fg-muted">{t("quizBuilder.bank.empty")}</p>
        ) : (
          <ul className={cn("flex flex-col gap-2 transition-opacity", search.isPlaceholderData && "opacity-60")}>
            {items.map((item) => (
              <BankResult
                key={item.question_id}
                item={item}
                checked={selected.has(item.question_id)}
                disabled={!selected.has(item.question_id) && selected.size >= remaining}
                onToggle={() => toggle(item)}
                reasonLabel={reasonLabel}
              />
            ))}
          </ul>
        )}
      </div>

      {rejected.length ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm">
          {addedCount ? <p className="text-fg">{t("quizBuilder.bank.added", { count: addedCount })}</p> : null}
          <p className="font-semibold text-fg">{t("quizBuilder.bank.rejectedTitle", { count: rejected.length })}</p>
          <ul className="flex flex-col gap-1 text-fg-muted">
            {rejected.map((entry) => (
              <li key={entry.question_id}>
                <span className="font-mono text-xs text-fg">{entry.question_id}</span>: {reasonLabel(entry.reason)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <Alert tone="danger" role="alert" message={error} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex items-center gap-2 text-[0.8125rem] text-fg-muted">
          <Button variant="secondary" size="sm" disabled={page === 0 || search.isFetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>
            {t("quizBuilder.bank.previous")}
          </Button>
          <span className="nums">{t("quizBuilder.bank.page", { page: page + 1, pages })}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page + 1 >= pages || search.isFetching}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("quizBuilder.bank.next")}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={adding}>
            {t("quizBuilder.bank.close")}
          </Button>
          <Button onClick={() => void add()} disabled={!selected.size} busy={adding}>
            {selected.size ? t("quizBuilder.bank.add", { count: selected.size }) : t("quizBuilder.bank.addNone")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-fg">
        {label}
      </label>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("quizBuilder.bank.any")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function BankResult({
  item,
  checked,
  disabled,
  onToggle,
  reasonLabel
}: {
  item: LiveBankItem;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  reasonLabel: (reason: string) => string;
}) {
  const { t } = useI18n();
  const id = useId();
  const unavailable = Boolean(item.reject_reason) || item.convertible_to === null;
  const licenseTone = item.license_scope === "own" ? "success" : item.license_scope === "pending_audit" ? "warning" : "neutral";
  return (
    <li>
      <label
        htmlFor={id}
        className={cn(
          "flex gap-3 rounded-md border p-3 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
          unavailable ? "cursor-not-allowed border-line bg-surface-muted/60" : "cursor-pointer",
          checked ? "border-primary bg-primary-soft/40" : !unavailable && "border-line hover:border-line-strong"
        )}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={unavailable || disabled}
          onChange={onToggle}
          aria-describedby={`${id}-meta`}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className={cn("text-sm leading-snug", unavailable ? "text-fg-muted" : "text-fg")}>{item.prompt}</span>
          {item.options.length ? (
            <span className="line-clamp-1 text-xs text-fg-subtle">
              {item.options.map((option) => `${option.key}) ${option.text}`).join("  ·  ")}
            </span>
          ) : null}
          <span id={`${id}-meta`} className="flex flex-wrap items-center gap-1.5">
            <Badge tone={licenseTone}>{t(`quizBuilder.license.${item.license_scope}`)}</Badge>
            {item.guest_eligible ? (
              <Badge tone="success">
                <CircleCheckIcon />
                {t("quizBuilder.bank.guestEligible")}
              </Badge>
            ) : (
              <Badge tone="neutral">
                <UsersIcon />
                {t("quizBuilder.bank.loginOnly")}
              </Badge>
            )}
            {item.certification ? <Badge tone="neutral">{item.certification}</Badge> : null}
            {item.domain ? <Badge tone="neutral" className="max-w-[16rem] truncate">{item.domain}</Badge> : null}
            {item.difficulty ? <Badge tone="neutral">{difficultyLabel(t, item.difficulty)}</Badge> : null}
            {item.convertible_to ? (
              <span className="text-xs text-fg-muted">
                {t("quizBuilder.bank.convertsTo", { type: t(`quizBuilder.types.${item.convertible_to}.name`) })}
              </span>
            ) : null}
          </span>
          {item.reject_reason ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-danger">
              <CircleXIcon size={14} />
              {t("quizBuilder.bank.unavailable", { reason: reasonLabel(item.reject_reason) })}
            </span>
          ) : item.convertible_to === null ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
              <InfoIcon size={14} />
              {t("quizBuilder.bank.notConvertible")}
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}
