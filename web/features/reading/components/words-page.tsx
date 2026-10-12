"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";

import { AuthRequiredNotice } from "@/components/ui/auth-required-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeftIcon, PlayIcon } from "@/components/ui/icons";
import { selectSmClassName } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page, PageHeader, Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatList } from "@/components/ui/stat";
import { ReviewSession } from "@/features/reading/components/word-review";
import { buildWordsPath, useDeleteWordMutation, useWordListQuery, useWordSummaryQuery, type WordKindFilter } from "@/features/reading/hooks";
import { formatCount, scoreToPercent } from "@/features/reading/lib/format";
import { apiClient, ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import type { ReadingWordCard, ReadingWordList } from "@/types/api";

const PAGE_SIZE = 50;
const KIND_FILTERS: readonly WordKindFilter[] = ["any", "pronunciation", "vocabulary"];

function isDue(card: ReadingWordCard, now: number): boolean {
  const due = Date.parse(card.due_at);
  return Number.isFinite(due) && due <= now;
}

function WordRow({ card, now, onDelete }: { card: ReadingWordCard; now: number; onDelete: (card: ReadingWordCard) => void }) {
  const { t, locale } = useI18n();
  const due = isDue(card, now);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span lang="en" className="font-serif text-base font-semibold text-fg">
            {card.word}
          </span>
          {card.ipa ? <span className="font-ipa text-xs text-fg-muted">/{card.ipa}/</span> : null}
          {card.meaning_pt ? <span className="text-sm text-fg-muted">· {card.meaning_pt}</span> : null}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <Badge tone={card.kind === "pronunciation" ? "primary" : "neutral"}>{t(`reading.words.kinds.${card.kind}`)}</Badge>
          {due ? <Badge tone="warning">{t("reading.words.list.dueNow")}</Badge> : <span>{t("reading.words.list.due", { date: formatDate(card.due_at, locale) })}</span>}
          {card.last_score !== null ? <span className="nums">{t("reading.words.list.lastScore", { percent: scoreToPercent(card.last_score) })}</span> : null}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => onDelete(card)} aria-label={t("reading.words.list.deleteWord", { word: card.word })}>
        {t("reading.words.list.delete")}
      </Button>
    </li>
  );
}

/** `/read/words`: deck summary, review session over due cards, and the full list with delete. */
export function WordsPage() {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const filterId = useId();
  const summary = useWordSummaryQuery();
  const [kind, setKind] = useState<WordKindFilter>("any");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const list = useWordListQuery("all", kind, limit);
  const remove = useDeleteWordMutation();
  const [toDelete, setToDelete] = useState<ReadingWordCard | null>(null);
  const [session, setSession] = useState<ReadingWordCard[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  // Fixed per render pass: "due now" badges.
  const [now] = useState(() => Date.now());

  const back = (
    <Link href="/read" className="focus-ring -ml-1 inline-flex items-center gap-1.5 self-start rounded-sm px-1 text-sm text-fg-muted hover:text-fg">
      <ArrowLeftIcon />
      {t("reading.words.back")}
    </Link>
  );
  const header = <PageHeader title={t("reading.words.title")} description={t("reading.words.subtitle")} />;

  async function startReview() {
    setStarting(true);
    setStartError(null);
    try {
      const due = await client.fetchQuery({
        queryKey: ["reading", "words", "session"],
        queryFn: ({ signal }) => apiClient.get<ReadingWordList>(buildWordsPath("due", "any", PAGE_SIZE), { signal }),
        staleTime: 0
      });
      setSession(due.items);
    } catch (error) {
      setStartError(error);
    } finally {
      setStarting(false);
    }
  }

  if (summary.isError && summary.error instanceof ApiError && summary.error.status === 401) {
    return (
      <Page>
        {back}
        {header}
        <AuthRequiredNotice title={t("reading.library.loginRequiredTitle")} message={t("reading.library.loginRequiredMessage")} />
      </Page>
    );
  }

  if (session) {
    return (
      <Page width="reading">
        {back}
        {header}
        <ReviewSession
          cards={session}
          onFinish={() => {
            setSession(null);
            void client.invalidateQueries({ queryKey: ["reading", "words"] });
          }}
        />
      </Page>
    );
  }

  const due = summary.data?.due ?? 0;
  const items = list.data?.items ?? [];

  return (
    <Page>
      {back}
      {header}

      <Section title={t("reading.words.summary.title")}>
        {summary.isPending ? (
          <Skeleton height={72} />
        ) : summary.isError ? (
          <QueryErrorBanner title={t("reading.words.loadFailed")} error={summary.error} onRetry={() => void summary.refetch()} retrying={summary.isFetching} />
        ) : (
          <StatList>
            <Stat label={t("reading.words.summary.due")} value={formatCount(due, locale)} emphasis />
            <Stat label={t("reading.words.summary.total")} value={formatCount(summary.data.total, locale)} />
            <Stat label={t("reading.words.summary.learned")} value={formatCount(summary.data.learned, locale)} />
          </StatList>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void startReview()} busy={starting} disabled={!due}>
            <PlayIcon />
            {t("reading.words.reviewNow")}
          </Button>
          {!summary.isPending && !due ? <p className="text-sm text-fg-muted">{t("reading.words.reviewEmpty")}</p> : null}
        </div>
        {startError ? <QueryErrorBanner title={t("reading.words.loadFailed")} error={startError} onRetry={() => void startReview()} retrying={starting} /> : null}
      </Section>

      <Section
        title={t("reading.words.list.title")}
        actions={
          <label htmlFor={filterId} className="inline-flex items-center gap-2 text-sm text-fg-muted">
            {t("reading.words.filter.label")}
            <select
              id={filterId}
              className={cn(selectSmClassName, "w-auto min-w-36")}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as WordKindFilter);
                setLimit(PAGE_SIZE);
              }}
            >
              {KIND_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === "any" ? t("reading.words.filter.any") : t(`reading.words.kinds.${value}`)}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {list.isPending ? (
          <Skeleton height={160} />
        ) : list.isError ? (
          <QueryErrorBanner title={t("reading.words.loadFailed")} error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />
        ) : !items.length ? (
          <EmptyState title={t("reading.words.list.emptyTitle")} description={t("reading.words.list.empty")} />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-line">
              {items.map((card) => (
                <WordRow key={card.id} card={card} now={now} onDelete={setToDelete} />
              ))}
            </ul>
            {list.data.total > items.length ? (
              <div>
                <Button variant="secondary" size="sm" onClick={() => setLimit((previous) => previous + PAGE_SIZE)} busy={list.isFetching}>
                  {t("reading.words.list.showMore", { shown: items.length, total: list.data.total })}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Section>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={t("reading.words.list.deleteTitle")}
        message={t("reading.words.list.deleteMessage", { word: toDelete?.word ?? "" })}
        confirmLabel={t("reading.words.list.delete")}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => {
          if (toDelete) {
            remove.mutate(toDelete.id, { onSettled: () => setToDelete(null) });
          }
        }}
        onCancel={() => setToDelete(null)}
      />
    </Page>
  );
}
