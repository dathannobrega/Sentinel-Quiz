"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { AuthRequiredNotice } from "@/components/ui/auth-required-notice";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeftIcon, BookIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { PlayerBar, type ReaderEngine } from "@/features/reading/components/player-bar";
import { ReadAlongBlock } from "@/features/reading/components/read-along-block";
import { ShadowPanel } from "@/features/reading/components/shadow-panel";
import { fetchTts, fetchTtsAudio, prefetchTts, useProgressReporter, useReadingCapabilitiesQuery, useReadingSectionQuery, type TtsParams } from "@/features/reading/hooks";
import { findBlockIndex, flattenBlocks, type ReaderBlock } from "@/features/reading/lib/blocks";
import { buildBookHref, buildReaderHref } from "@/features/reading/lib/hrefs";
import { isTypingTarget } from "@/features/reading/lib/keyboard";
import { DEFAULT_READING_PREFS, readReadingPrefs, writeReadingPrefs, type ReaderMode, type ReadingPrefs } from "@/features/reading/lib/prefs";
import { findTokenIndexAtChar, mapWordsToTokens, type WordTiming } from "@/features/reading/lib/tokenize";
import { useAudioPlayer } from "@/features/reading/lib/use-audio-player";
import { isWebSpeechSupported, speak, type SpeechHandle } from "@/features/reading/lib/web-speech";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { ReadingAssessedWord, ReadingCapabilities, ReadingSectionDetail, ReadingTtsResponse } from "@/types/api";

const DEFAULT_SPEEDS = [0.75, 0.9, 1, 1.1, 1.25];
const AUDIO_CACHE_LIMIT = 6;
const LISTEN_DRAIN_MS = 10_000;

interface BlockAudio {
  tts: ReadingTtsResponse;
  url: string;
  timings: WordTiming[];
}

function SectionNav({ detail, t }: { detail: ReadingSectionDetail; t: (key: string) => string }) {
  if (!detail.previous && !detail.next) {
    return <p className="border-t border-line pt-5 text-sm text-fg-muted">{t("reading.reader.endOfBook")}</p>;
  }
  const card =
    "focus-ring group flex min-w-0 flex-col gap-1 rounded-lg border border-line px-4 py-3 transition-colors hover:border-primary/50 hover:bg-surface-muted";
  return (
    <nav aria-label={t("reading.reader.navigation")} className="grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
      {detail.previous ? (
        <Link href={buildReaderHref(detail.previous.id)} className={card}>
          <span className="flex items-center gap-1 text-xs text-fg-muted">
            <ChevronLeftIcon size={14} />
            {t("reading.reader.previous")}
          </span>
          <span className="truncate text-sm font-medium text-primary">{detail.previous.title}</span>
        </Link>
      ) : (
        <span aria-hidden className="hidden sm:block" />
      )}
      {detail.next ? (
        <Link href={buildReaderHref(detail.next.id)} className={cn(card, "sm:items-end sm:text-right")}>
          <span className="flex items-center gap-1 text-xs text-fg-muted">
            {t("reading.reader.next")}
            <ChevronRightIcon size={14} />
          </span>
          <span className="max-w-full truncate text-sm font-medium text-primary">{detail.next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}

/** The interactive reader once the section and the capabilities are known. */
function ReaderView({ detail, capabilities }: { detail: ReadingSectionDetail; capabilities: ReadingCapabilities | undefined }) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const blocks = useMemo(() => flattenBlocks(detail), [detail]);

  // Preferences: defaults on the server render, the stored values after mount.
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS);
  const prefsLoadedRef = useRef(false);
  useEffect(() => {
    const stored = readReadingPrefs();
    prefsLoadedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage after mount
    setPrefs(stored);
  }, []);
  const updatePrefs = useCallback((patch: Partial<ReadingPrefs>) => {
    setPrefs((previous) => {
      const next = { ...previous, ...patch };
      if (prefsLoadedRef.current) {
        writeReadingPrefs(next);
      }
      return next;
    });
  }, []);

  const ttsCapability = capabilities?.tts;
  const ttsAvailable = Boolean(ttsCapability?.available);
  const assessAvailable = Boolean(capabilities?.assess?.available);
  const voices = ttsCapability?.voices ?? [];
  const speeds = ttsCapability?.speeds?.length ? ttsCapability.speeds : DEFAULT_SPEEDS;
  const voice = prefs.voice && voices.some((item) => item.id === prefs.voice) ? prefs.voice : (ttsCapability?.default_voice ?? voices[0]?.id ?? null);
  const speed = speeds.includes(prefs.speed) ? prefs.speed : 1;
  const mode: ReaderMode = prefs.mode === "shadow" && assessAvailable ? "shadow" : "listen";

  const [engineOverride, setEngineOverride] = useState<ReaderEngine | null>(null);
  const engine: ReaderEngine = engineOverride ?? (ttsAvailable ? "tts" : "browser");
  const webSpeechSupported = typeof window !== "undefined" && isWebSpeechSupported();
  const [notice, setNotice] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Active block (resume from saved progress once per section).
  const [activeIndex, setActiveIndex] = useState(() => findBlockIndex(blocks, detail.progress?.part_id, detail.progress?.block_index));
  const [resumed] = useState(() => activeIndex > 0);
  const activeBlock: ReaderBlock | undefined = blocks[activeIndex];

  // Progress reporting.
  const progress = useProgressReporter({ bookSlug: detail.book_slug, sectionId: detail.section_id });
  const progressMode = mode === "shadow" ? "shadow" : "listen";

  // Neural audio cache keyed by block + voice + speed (blob URLs revoked on eviction and unmount).
  const audioCacheRef = useRef(new Map<string, BlockAudio>());
  /** Cache key of the entry currently loaded in the player. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);

  useEffect(() => {
    const cache = audioCacheRef.current;
    return () => {
      cache.forEach((entry) => URL.revokeObjectURL(entry.url));
      cache.clear();
    };
  }, []);

  const ttsParamsFor = useCallback(
    (block: ReaderBlock): TtsParams => ({ sectionId: detail.section_id, partId: block.partId, blockIndex: block.blockIndex, voice, speed }),
    [detail.section_id, speed, voice]
  );
  const cacheKeyFor = useCallback((block: ReaderBlock) => `${block.key}|${voice ?? ""}|${speed}`, [speed, voice]);

  const switchToBrowser = useCallback(
    (reason: string | null) => {
      setEngineOverride("browser");
      setNotice(webSpeechSupported ? (reason === "speech_warming" ? t("reading.capabilities.ttsWarming") : t("reading.reader.fallbackNotice")) : t("reading.reader.fallbackUnsupported"));
    },
    [t, webSpeechSupported]
  );

  /** Resolves (and caches) the TTS + audio blob for a block; retries the TTS once on `audio_not_found`. */
  const ensureAudio = useCallback(
    async (block: ReaderBlock): Promise<BlockAudio | null> => {
      const key = cacheKeyFor(block);
      const cached = audioCacheRef.current.get(key);
      if (cached) {
        return cached;
      }
      const params = ttsParamsFor(block);
      let tts: ReadingTtsResponse;
      try {
        tts = await fetchTts(queryClient, params);
      } catch (error) {
        if (error instanceof ApiError && (error.code === "speech_unavailable" || error.code === "speech_warming" || error.status === 503)) {
          switchToBrowser(error.code);
          return null;
        }
        throw error;
      }
      let blob: Blob;
      try {
        blob = await fetchTtsAudio(tts.audio_url);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          tts = await fetchTts(queryClient, params, { force: true });
          blob = await fetchTtsAudio(tts.audio_url);
        } else {
          throw error;
        }
      }
      const entry: BlockAudio = {
        tts,
        url: URL.createObjectURL(blob),
        timings: mapWordsToTokens(tts.words, block.tokens)
      };
      const cache = audioCacheRef.current;
      if (cache.size >= AUDIO_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          const evicted = cache.get(oldest);
          cache.delete(oldest);
          if (evicted && oldest !== loadedKey) {
            URL.revokeObjectURL(evicted.url);
          }
        }
      }
      cache.set(key, entry);
      return entry;
    },
    [cacheKeyFor, loadedKey, queryClient, switchToBrowser, ttsParamsFor]
  );

  // Browser speech fallback state.
  const speechRef = useRef<SpeechHandle | null>(null);
  const [speechPlaying, setSpeechPlaying] = useState(false);
  const [speechWordIndex, setSpeechWordIndex] = useState(-1);
  const speechStartedAtRef = useRef<number | null>(null);
  const stopSpeech = useCallback(() => {
    speechRef.current?.cancel();
    speechRef.current = null;
    if (speechStartedAtRef.current !== null) {
      progress.addSeconds((performance.now() - speechStartedAtRef.current) / 1000);
      speechStartedAtRef.current = null;
    }
    setSpeechPlaying(false);
  }, [progress]);

  const autoAdvanceRef = useRef(prefs.autoAdvance);
  useEffect(() => {
    autoAdvanceRef.current = prefs.autoAdvance;
  }, [prefs.autoAdvance]);
  const goToRef = useRef<(index: number, autoplay: boolean) => void>(() => {});
  const loadBlockRef = useRef<(index: number, autoplay: boolean) => Promise<void>>(async () => {});

  const handleBlockEnded = useCallback(() => {
    const block = blocks[activeIndex];
    if (block) {
      progress.addWords(block.tokens.length);
    }
    if (!autoAdvanceRef.current) {
      return;
    }
    const next = detail.next;
    if (activeIndex + 1 < blocks.length) {
      goToRef.current(activeIndex + 1, true);
    } else if (next) {
      void progress.flush().then(() => router.push(buildReaderHref(next.id)));
    }
  }, [activeIndex, blocks, detail.next, progress, router]);

  const player = useAudioPlayer({
    playbackRate: 1,
    onEnded: handleBlockEnded,
    onError: () => setAudioError(t("reading.reader.audioFailed"))
  });
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  // Whether the player holds the audio of the active block for the current voice/speed.
  const activeLoaded = Boolean(activeBlock && loadedKey === cacheKeyFor(activeBlock));

  /** Loads the neural audio of a block into the player (autoplay optional) and prefetches the next. */
  const loadBlock = useCallback(
    async (index: number, autoplay: boolean) => {
      const block = blocks[index];
      if (!block) {
        return;
      }
      setAudioError(null);
      if (engine === "browser") {
        stopSpeech();
        playerRef.current.stop();
        setSpeechWordIndex(-1);
        if (autoplay && webSpeechSupported) {
          speechStartedAtRef.current = performance.now();
          setSpeechPlaying(true);
          speechRef.current = speak({
            text: block.text,
            rate: speed,
            onBoundary: (charIndex) => setSpeechWordIndex(findTokenIndexAtChar(block.tokens, charIndex)),
            onEnd: () => {
              speechRef.current = null;
              if (speechStartedAtRef.current !== null) {
                progress.addSeconds((performance.now() - speechStartedAtRef.current) / 1000);
                speechStartedAtRef.current = null;
              }
              setSpeechPlaying(false);
              setSpeechWordIndex(block.tokens.length - 1);
              handleBlockEnded();
            },
            onError: () => {
              speechRef.current = null;
              setSpeechPlaying(false);
              setAudioError(t("reading.reader.audioFailed"));
            }
          });
        }
        return;
      }
      setAudioLoading(true);
      try {
        const entry = await ensureAudio(block);
        if (!entry) {
          // Switched to the browser voice while loading: replay through that path.
          if (autoplay) {
            setAudioLoading(false);
            return loadBlockRef.current(index, autoplay);
          }
          return;
        }
        setLoadedKey(cacheKeyFor(block));
        await playerRef.current.load(entry.url, entry.timings, { autoplay });
        const next = blocks[index + 1];
        if (next) {
          void prefetchTts(queryClient, ttsParamsFor(next));
        }
      } catch {
        setAudioError(t("reading.reader.audioFailed"));
      } finally {
        setAudioLoading(false);
      }
    },
    [blocks, cacheKeyFor, engine, ensureAudio, handleBlockEnded, progress, queryClient, speed, stopSpeech, t, ttsParamsFor, webSpeechSupported]
  );
  useEffect(() => {
    loadBlockRef.current = loadBlock;
  }, [loadBlock]);

  // Browser voice: the rate change only applies to the next utterance (speechSynthesis has no live rate).
  const goTo = useCallback(
    (index: number, autoplay: boolean) => {
      if (index < 0 || index >= blocks.length) {
        return;
      }
      progress.addSeconds(playerRef.current.drainListenedSeconds());
      stopSpeech();
      setActiveIndex(index);
      void loadBlock(index, autoplay);
    },
    [blocks.length, loadBlock, progress, stopSpeech]
  );
  useEffect(() => {
    goToRef.current = goTo;
  }, [goTo]);

  // Report the position whenever the active block (or the mode) changes.
  useEffect(() => {
    const block = blocks[activeIndex];
    if (block) {
      progress.report({ partId: block.partId, blockIndex: block.blockIndex, mode: progressMode });
    }
  }, [activeIndex, blocks, progress, progressMode]);

  // Drain listening time periodically so a long paragraph is not lost on a crash.
  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      progress.addSeconds(playerRef.current.drainListenedSeconds());
    }, LISTEN_DRAIN_MS);
    return () => {
      globalThis.clearInterval(timer);
      progress.addSeconds(playerRef.current.drainListenedSeconds());
    };
  }, [progress]);

  // Stop the browser voice when leaving.
  useEffect(() => () => stopSpeech(), [stopSpeech]);

  // Voice or speed change: the loaded audio is for the previous settings; reload paused.
  const settingsKeyRef = useRef(`${voice}|${speed}|${engine}`);
  useEffect(() => {
    const key = `${voice}|${speed}|${engine}`;
    if (settingsKeyRef.current === key) {
      return;
    }
    settingsKeyRef.current = key;
    const wasPlaying = playerRef.current.state.status === "playing" || speechPlaying;
    goTo(activeIndex, wasPlaying);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the settings key
  }, [voice, speed, engine]);

  const isPlaying = engine === "browser" ? speechPlaying : player.state.status === "playing";
  const isLoading = audioLoading || (engine === "tts" && player.state.status === "loading");
  const canPlay = engine === "tts" || webSpeechSupported;

  const togglePlayback = useCallback(() => {
    if (engine === "browser") {
      if (speechPlaying) {
        stopSpeech();
      } else {
        void loadBlock(activeIndex, true);
      }
      return;
    }
    if (activeLoaded) {
      playerRef.current.toggle();
    } else {
      void loadBlock(activeIndex, true);
    }
  }, [activeIndex, activeLoaded, engine, loadBlock, speechPlaying, stopSpeech]);

  const seekToWord = useCallback(
    (tokenIndex: number) => {
      if (engine !== "tts") {
        return;
      }
      const run = async () => {
        if (!activeLoaded) {
          await loadBlock(activeIndex, false);
        }
        const entry = activeBlock ? audioCacheRef.current.get(cacheKeyFor(activeBlock)) : undefined;
        const timing = entry?.timings[tokenIndex];
        if (timing) {
          playerRef.current.seek(timing.start, { play: true });
        }
      };
      void run();
    },
    [activeBlock, activeIndex, activeLoaded, cacheKeyFor, engine, loadBlock]
  );

  // Shadowing helpers: play the model audio (whole block or one word).
  const [modelBusy, setModelBusy] = useState(false);
  const playModel = useCallback(async () => {
    if (engine !== "tts") {
      void loadBlock(activeIndex, true);
      return;
    }
    setModelBusy(true);
    try {
      if (!activeLoaded) {
        await loadBlock(activeIndex, false);
      }
      playerRef.current.seek(0, { play: true });
    } finally {
      setModelBusy(false);
    }
  }, [activeIndex, activeLoaded, engine, loadBlock]);

  const playModelWord = useCallback(
    async (word: ReadingAssessedWord) => {
      if (engine !== "tts" || !activeBlock) {
        return;
      }
      setModelBusy(true);
      try {
        if (!activeLoaded) {
          await loadBlock(activeIndex, false);
        }
        const entry = audioCacheRef.current.get(cacheKeyFor(activeBlock));
        const match = entry?.tts.words.find((item) => item.char_start < word.char_end && word.char_start < item.char_end);
        if (match) {
          playerRef.current.playRange(Math.max(0, match.start - 0.05), match.end + 0.12);
        }
      } finally {
        setModelBusy(false);
      }
    },
    [activeBlock, activeIndex, activeLoaded, cacheKeyFor, engine, loadBlock]
  );

  const pauseAll = useCallback(() => {
    stopSpeech();
    playerRef.current.pause();
  }, [stopSpeech]);

  // Keyboard: space (play/pause), arrows (blocks). `R` belongs to the shadow panel.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(activeIndex - 1, isPlaying);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        const block = blocks[activeIndex];
        if (block) {
          progress.addWords(block.tokens.length);
        }
        goTo(activeIndex + 1, isPlaying);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeIndex, blocks, goTo, isPlaying, progress, togglePlayback]);

  const currentWordIndex = engine === "browser" ? speechWordIndex : activeLoaded ? player.state.currentWordIndex : -1;
  const positionPercent = detail.position.total > 0 ? (detail.position.index / detail.position.total) * 100 : 0;
  const bookTitle = detail.book_title;
  const chapterTitle = detail.chapter_title || detail.breadcrumb[0] || "";

  return (
    <>
      <Page width="reading" className="pb-8">
        <header className="flex flex-col gap-3">
          <Link href={buildBookHref(detail.book_slug)} className="focus-ring -ml-1 inline-flex items-center gap-1.5 self-start rounded-sm px-1 text-sm text-fg-muted hover:text-fg">
            <ArrowLeftIcon />
            {t("reading.reader.backToBook")}
          </Link>
          <p className="inline-flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-fg-muted">
            <BookIcon size={13} className="text-fg-subtle" />
            <span>{bookTitle}</span>
            {chapterTitle ? (
              <>
                <span aria-hidden="true">›</span>
                <span>{chapterTitle}</span>
              </>
            ) : null}
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg sm:text-[1.75rem] sm:leading-tight">{detail.title}</h1>
          <div className="flex items-center gap-3">
            <Meter value={positionPercent} label={t("reading.reader.progressLabel")} className="max-w-xs" />
            <span className="nums text-xs text-fg-muted">{t("reading.reader.position", { index: detail.position.index, total: detail.position.total })}</span>
          </div>
        </header>

        {notice ? <Alert tone="warning" message={notice} /> : null}
        {audioError ? <Alert tone="danger" role="alert" message={audioError} /> : null}
        {resumed ? <Alert tone="neutral" message={t("reading.reader.resumeNotice")} /> : null}

        <article className="flex flex-col gap-3">
          {blocks.map((block, index) => {
            const HeadingTag = block.partDepth <= 1 ? "h2" : "h3";
            const isActive = index === activeIndex;
            return (
              <Fragment key={block.key}>
                {block.startsPart ? (
                  <HeadingTag className={cn("font-semibold text-fg", block.partDepth <= 1 ? "mt-6 text-xl" : "mt-4 text-lg")}>{block.partTitle}</HeadingTag>
                ) : null}
                <ReadAlongBlock
                  block={block}
                  position={index + 1}
                  total={blocks.length}
                  active={isActive}
                  currentWordIndex={isActive ? currentWordIndex : -1}
                  follow={prefs.follow}
                  onActivate={() => goTo(index, false)}
                  onWordClick={mode === "listen" && engine === "tts" ? seekToWord : undefined}
                />
                {isActive && mode === "shadow" && activeBlock ? (
                  <ShadowPanel
                    sectionId={detail.section_id}
                    block={activeBlock}
                    assessAvailable={assessAvailable}
                    maxSeconds={capabilities?.assess?.max_seconds || undefined}
                    onListenModel={() => void playModel()}
                    onPlayWord={(word) => void playModelWord(word)}
                    modelBusy={modelBusy}
                    onBeforeRecord={pauseAll}
                  />
                ) : null}
              </Fragment>
            );
          })}
          {detail.truncated ? <p className="text-sm text-fg-muted italic">{t("reading.reader.truncated")}</p> : null}
        </article>

        <p className="sr-only">{t("reading.reader.shortcuts")}</p>
        <SectionNav detail={detail} t={t} />
      </Page>

      <PlayerBar
        isPlaying={isPlaying}
        isLoading={isLoading}
        canPlay={canPlay}
        blockLabel={t("reading.reader.block", { index: activeIndex + 1, total: blocks.length })}
        hasPrevious={activeIndex > 0}
        hasNext={activeIndex + 1 < blocks.length}
        onToggle={togglePlayback}
        onPrevious={() => goTo(activeIndex - 1, isPlaying)}
        onNext={() => {
          if (activeBlock) {
            progress.addWords(activeBlock.tokens.length);
          }
          goTo(activeIndex + 1, isPlaying);
        }}
        speed={speed}
        speeds={speeds}
        onSpeedChange={(value) => updatePrefs({ speed: value })}
        engine={engine}
        voice={voice}
        voices={voices}
        onVoiceChange={(value) => updatePrefs({ voice: value })}
        autoAdvance={prefs.autoAdvance}
        onAutoAdvanceChange={(value) => updatePrefs({ autoAdvance: value })}
        follow={prefs.follow}
        onFollowChange={(value) => updatePrefs({ follow: value })}
        mode={mode}
        onModeChange={(value) => {
          if (value === "shadow") {
            pauseAll();
          }
          updatePrefs({ mode: value });
        }}
        shadowEnabled={assessAvailable}
      />
    </>
  );
}

/** `/read/s/[sectionId]`: listen, read along and shadow one book section. */
export function Reader({ sectionId }: { sectionId: string }) {
  const { t } = useI18n();
  const section = useReadingSectionQuery(sectionId);
  const capabilities = useReadingCapabilitiesQuery();

  if (section.isPending || (capabilities.isPending && !capabilities.isError)) {
    return (
      <Page width="reading" aria-busy="true">
        <span className="sr-only" role="status">
          {t("reading.reader.loading")}
        </span>
        <Skeleton height={14} className="max-w-60" />
        <Skeleton height={40} className="max-w-md" />
        <Skeleton height={320} />
      </Page>
    );
  }

  if (section.isError) {
    const status = section.error instanceof ApiError ? section.error.status : 0;
    return (
      <Page width="reading">
        {status === 401 ? (
          <AuthRequiredNotice title={t("reading.reader.loginRequiredTitle")} message={t("reading.reader.loginRequiredMessage")} />
        ) : status === 404 ? (
          <EmptyState title={t("reading.reader.notFoundTitle")} description={t("reading.reader.notFoundMessage")} />
        ) : (
          <QueryErrorBanner title={t("reading.reader.loadFailed")} error={section.error} onRetry={() => void section.refetch()} retrying={section.isFetching} />
        )}
      </Page>
    );
  }

  return <ReaderView key={sectionId} detail={section.data} capabilities={capabilities.data} />;
}
