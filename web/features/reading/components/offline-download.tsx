"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CircleCheckIcon, DownloadIcon, XIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { fetchOfflineManifest, fetchTtsAudio, requestTts, sectionPath } from "@/features/reading/hooks";
import { useOfflineIndexQuery, useOfflineStore, useRefreshOfflineIndex } from "@/features/reading/lib/offline-hooks";
import {
  DEFAULT_MAX_OFFLINE_CHAPTERS,
  downloadChapter,
  formatMegabytes,
  offlineChapterId,
  OfflineLimitError,
  requestPersistentStorage,
  type OfflineDownloadProgress
} from "@/features/reading/lib/offline-store";
import { readReadingPrefs } from "@/features/reading/lib/prefs";
import { apiClient } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import type { ReadingCapabilities, ReadingSectionDetail } from "@/types/api";

export interface ChapterOfflineControlProps {
  bookSlug: string;
  chapterFile: string;
  chapterTitle: string;
  capabilities: ReadingCapabilities | undefined;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * "Download to listen offline" for one chapter: sequential download with progress, cancel, resume
 * (skips what is cached), size estimate and removal. Limited to `capabilities.offline.max_chapters`.
 */
export function ChapterOfflineControl({ bookSlug, chapterFile, chapterTitle, capabilities }: ChapterOfflineControlProps) {
  const { t } = useI18n();
  const store = useOfflineStore();
  const index = useOfflineIndexQuery();
  const refresh = useRefreshOfflineIndex();
  const manifest = useQuery({
    queryKey: ["reading", "offline-manifest", bookSlug, chapterFile],
    queryFn: ({ signal }) => fetchOfflineManifest(bookSlug, chapterFile, signal),
    enabled: Boolean(store),
    staleTime: 10 * 60_000,
    retry: false
  });
  const [progress, setProgress] = useState<OfflineDownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Seconds the download is pausing for (rate limit or speech service busy); null while running.
  const [waitSeconds, setWaitSeconds] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (store === undefined) {
    // Not resolved yet (server render / hydration): render nothing rather than a wrong verdict.
    return null;
  }
  if (store === null) {
    return <p className="text-xs text-fg-muted">{t("reading.offline.unsupported")}</p>;
  }

  const id = offlineChapterId(bookSlug, chapterFile);
  const entry = index.data?.chapters.find((chapter) => chapter.id === id) ?? null;
  const maxChapters = capabilities?.offline?.max_chapters || DEFAULT_MAX_OFFLINE_CHAPTERS;
  const atLimit = !entry && (index.data?.chapters.length ?? 0) >= maxChapters;
  const downloading = progress !== null;
  const estimate = manifest.data ? manifest.data.estimated_audio_mb.toFixed(1) : null;

  async function start() {
    if (!store) {
      return;
    }
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: entry?.doneBlocks ?? 0, total: entry?.totalBlocks ?? manifest.data?.total_blocks ?? 0, bytes: entry?.bytes ?? 0 });
    void requestPersistentStorage();
    const prefs = readReadingPrefs();
    const voices = capabilities?.tts?.voices ?? [];
    const voice = prefs.voice && voices.some((item) => item.id === prefs.voice) ? prefs.voice : (capabilities?.tts?.default_voice ?? null);
    const speeds = capabilities?.tts?.speeds ?? [];
    const speed = speeds.includes(prefs.speed) ? prefs.speed : 1;
    try {
      await downloadChapter(store, {
        bookSlug,
        chapterFile,
        voice,
        speed,
        maxChapters,
        signal: controller.signal,
        onWait: setWaitSeconds,
        onProgress: (next) => {
          setProgress(next);
          void refresh();
        },
        api: {
          fetchManifest: (signal) => fetchOfflineManifest(bookSlug, chapterFile, signal),
          fetchSection: (sectionId, signal) => apiClient.get<ReadingSectionDetail>(sectionPath(sectionId), { signal }),
          fetchTts: (sectionId, partId, blockIndex, signal) => requestTts({ sectionId, partId, blockIndex, voice, speed }, signal),
          fetchAudio: (tts, signal) => fetchTtsAudio(tts.audio_url, signal)
        }
      });
    } catch (reason) {
      if (reason instanceof OfflineLimitError) {
        setError(t("reading.offline.limitReached", { max: reason.maxChapters }));
      } else if (!isAbort(reason) && !controller.signal.aborted) {
        setError(t("reading.offline.failed"));
      }
    } finally {
      abortRef.current = null;
      setWaitSeconds(null);
      setProgress(null);
      void refresh();
    }
  }

  async function remove() {
    if (!store) {
      return;
    }
    setRemoving(true);
    try {
      await store.removeChapter(id);
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
      void refresh();
    }
  }

  const removeDialog = (
    <ConfirmDialog
      open={confirmRemove}
      title={t("reading.offline.removeTitle")}
      message={t("reading.offline.removeMessage", { chapter: chapterTitle })}
      confirmLabel={t("reading.offline.remove")}
      tone="danger"
      busy={removing}
      onConfirm={() => void remove()}
      onCancel={() => setConfirmRemove(false)}
    />
  );

  if (downloading) {
    const percent = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
    return (
      <div className="flex flex-col gap-2 rounded-md border border-line px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="nums text-sm text-fg" role="status">
            {t("reading.offline.downloading", { done: progress.done, total: progress.total })}
          </span>
          <span className="nums text-xs text-fg-muted">{t("reading.offline.size", { mb: formatMegabytes(progress.bytes) })}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => abortRef.current?.abort()}>
            <XIcon />
            {t("reading.offline.cancel")}
          </Button>
        </div>
        <Meter value={percent} label={t("reading.offline.progressLabel", { chapter: chapterTitle })} />
        {waitSeconds !== null ? (
          <p className="text-xs text-fg-muted" role="status">
            {t("reading.offline.waiting", { seconds: waitSeconds })}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {entry?.complete ? (
          <>
            <Badge tone="success">
              <CircleCheckIcon />
              {t("reading.offline.downloaded")}
            </Badge>
            <span className="nums text-xs text-fg-muted">{t("reading.offline.size", { mb: formatMegabytes(entry.bytes) })}</span>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
              {t("reading.offline.remove")}
            </Button>
          </>
        ) : entry ? (
          <>
            <span className="nums text-xs text-fg-muted">{t("reading.offline.partial", { done: entry.doneBlocks, total: entry.totalBlocks })}</span>
            <Button variant="secondary" size="sm" onClick={() => void start()}>
              <DownloadIcon />
              {t("reading.offline.resume")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
              {t("reading.offline.remove")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => void start()} disabled={atLimit}>
              <DownloadIcon />
              {t("reading.offline.download")}
            </Button>
            {estimate ? <span className="nums text-xs text-fg-muted">{t("reading.offline.estimate", { mb: estimate })}</span> : null}
          </>
        )}
      </div>
      {atLimit ? <p className="text-xs text-fg-muted">{t("reading.offline.limitReached", { max: maxChapters })}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {removeDialog}
    </div>
  );
}
