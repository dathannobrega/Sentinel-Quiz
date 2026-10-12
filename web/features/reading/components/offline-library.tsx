"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeftIcon, HeadphonesIcon, PlayIcon } from "@/components/ui/icons";
import { Page, PageHeader, Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { ReaderView, type ReaderNavigation } from "@/features/reading/components/reader";
import { useOfflineIndexQuery, useOfflineStore, useRefreshOfflineIndex } from "@/features/reading/lib/offline-hooks";
import { formatMegabytes, type OfflineChapterEntry, type OfflineStore } from "@/features/reading/lib/offline-store";
import { createOfflineSource } from "@/features/reading/lib/reader-source";
import { useI18n } from "@/lib/i18n";
import type { ReadingCapabilities } from "@/types/api";

/** Capabilities of the offline reader: the downloaded voice/speed only; nothing that needs the API. */
export function offlineCapabilities(entry: OfflineChapterEntry): ReadingCapabilities {
  return {
    enabled: true,
    books_available: true,
    tts: {
      available: true,
      reason: null,
      engine: "offline",
      model: null,
      default_voice: entry.voice,
      voices: entry.voice ? [{ id: entry.voice, label: entry.voice, lang: "en-US", gender: "" }] : [],
      speeds: [entry.speed]
    },
    assess: { available: false, reason: "disabled", engine: null, model: null, max_audio_bytes: 0, max_seconds: 0 }
  };
}

function OfflineSectionReader({
  store,
  entry,
  sectionId,
  onOpen,
  onBack
}: {
  store: OfflineStore;
  entry: OfflineChapterEntry;
  sectionId: string;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const section = useQuery({
    queryKey: ["reading-offline", "section", sectionId],
    queryFn: () => store.getSection(sectionId),
    networkMode: "always",
    staleTime: Number.POSITIVE_INFINITY
  });
  const source = useMemo(() => createOfflineSource(store), [store]);
  const capabilities = useMemo(() => offlineCapabilities(entry), [entry]);
  const ids = useMemo(() => new Set(entry.sections.map((item) => item.id)), [entry.sections]);
  const navigation = useMemo<ReaderNavigation>(
    () => ({
      open: onOpen,
      canOpen: (id) => ids.has(id),
      back: { label: t("reading.offline.back"), onClick: onBack },
      useLinks: false
    }),
    [ids, onBack, onOpen, t]
  );

  if (section.isPending) {
    return (
      <Page width="reading" aria-busy="true">
        <Skeleton height={40} className="max-w-md" />
        <Skeleton height={320} />
      </Page>
    );
  }
  if (!section.data) {
    return (
      <Page width="reading">
        <button type="button" onClick={onBack} className="focus-ring -ml-1 inline-flex items-center gap-1.5 self-start rounded-sm px-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeftIcon />
          {t("reading.offline.back")}
        </button>
        <EmptyState title={t("reading.offline.sectionUnavailable")} />
      </Page>
    );
  }
  return <ReaderView key={sectionId} detail={section.data} capabilities={capabilities} source={source} navigation={navigation} />;
}

/** `/read/offline`: the downloaded chapters, played entirely from Cache Storage (no API calls). */
export function OfflineLibrary() {
  const { t } = useI18n();
  const store = useOfflineStore();
  const index = useOfflineIndexQuery();
  const refresh = useRefreshOfflineIndex();
  const [open, setOpen] = useState<{ chapterId: string; sectionId: string } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const header = <PageHeader title={t("reading.offline.pageTitle")} description={t("reading.offline.pageSubtitle")} />;
  const chapters = index.data?.chapters ?? [];
  const openEntry = open ? chapters.find((chapter) => chapter.id === open.chapterId) : undefined;

  if (store && open && openEntry) {
    return (
      <OfflineSectionReader
        store={store}
        entry={openEntry}
        sectionId={open.sectionId}
        onOpen={(sectionId) => setOpen({ chapterId: openEntry.id, sectionId })}
        onBack={() => setOpen(null)}
      />
    );
  }

  const removeEntry = removeId ? chapters.find((chapter) => chapter.id === removeId) : undefined;

  return (
    <Page>
      <Link href="/read" className="focus-ring -ml-1 inline-flex items-center gap-1.5 self-start rounded-sm px-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeftIcon />
        {t("reading.book.back")}
      </Link>
      {header}
      {store === null ? (
        <Alert tone="warning" message={t("reading.offline.unsupported")} />
      ) : store === undefined || index.isPending ? (
        <Skeleton height={160} />
      ) : !chapters.length ? (
        <EmptyState
          title={t("reading.offline.emptyTitle")}
          description={t("reading.offline.emptyMessage")}
          action={
            <Link href="/read" className={buttonClassName("secondary", "sm")}>
              {t("reading.offline.openLibrary")}
            </Link>
          }
        />
      ) : (
        <Section title={t("reading.offline.chaptersTitle")}>
          <ul className="flex flex-col gap-4">
            {chapters.map((chapter) => (
              <li key={chapter.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-fg-muted">{chapter.bookTitle}</p>
                    <h3 className="text-base font-semibold text-fg">{chapter.chapterTitle}</h3>
                    <p className="nums text-xs text-fg-muted">
                      {t("reading.offline.chapterMeta", { sections: chapter.sections.length, mb: formatMegabytes(chapter.bytes) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {chapter.complete ? (
                      <Badge tone="success">{t("reading.offline.downloaded")}</Badge>
                    ) : (
                      <Badge tone="warning">{t("reading.offline.partial", { done: chapter.doneBlocks, total: chapter.totalBlocks })}</Badge>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setRemoveId(chapter.id)}>
                      {t("reading.offline.remove")}
                    </Button>
                  </div>
                </div>
                <ol className="flex flex-col divide-y divide-line">
                  {chapter.sections.map((section) => (
                    <li key={section.id} className="flex items-center gap-3 py-2">
                      <HeadphonesIcon size={14} className="shrink-0 text-fg-subtle" />
                      <span className="min-w-0 flex-1 text-sm text-fg">{section.title}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpen({ chapterId: chapter.id, sectionId: section.id })}
                        aria-label={t("reading.offline.playSection", { section: section.title })}
                      >
                        <PlayIcon />
                        {t("reading.offline.play")}
                      </Button>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <ConfirmDialog
        open={Boolean(removeEntry)}
        title={t("reading.offline.removeTitle")}
        message={t("reading.offline.removeMessage", { chapter: removeEntry?.chapterTitle ?? "" })}
        confirmLabel={t("reading.offline.remove")}
        tone="danger"
        busy={removing}
        onConfirm={() => {
          if (!store || !removeId) {
            return;
          }
          setRemoving(true);
          void store
            .removeChapter(removeId)
            .finally(() => {
              setRemoving(false);
              setRemoveId(null);
              void refresh();
            });
        }}
        onCancel={() => setRemoveId(null)}
      />
    </Page>
  );
}
