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
import { ComprehensionCard } from "@/features/reading/components/comprehension-card";
import { DrillPanel } from "@/features/reading/components/drill-panel";
import { GlossaryPopover, type GlossaryTarget } from "@/features/reading/components/glossary-popover";
import { ListenRepeatPanel } from "@/features/reading/components/listen-repeat-panel";
import { PlayerBar, type ReaderEngine } from "@/features/reading/components/player-bar";
import { ReadAlongBlock } from "@/features/reading/components/read-along-block";
import { ShadowPanel } from "@/features/reading/components/shadow-panel";
import { useProgressReporter, useReadingCapabilitiesQuery, useReadingSectionQuery, type TtsParams } from "@/features/reading/hooks";
import { findBlockIndex, flattenBlocks, type ReaderBlock } from "@/features/reading/lib/blocks";
import { buildBookHref, buildReaderHref } from "@/features/reading/lib/hrefs";
import { isTypingTarget } from "@/features/reading/lib/keyboard";
import { bindMediaSession, setMediaPlaybackState, setMediaPosition, type MediaSessionHandlers } from "@/features/reading/lib/media-session";
import { useOnlineStatus } from "@/features/reading/lib/online-status";
import { DEFAULT_READING_PREFS, readReadingPrefs, writeReadingPrefs, type ReaderMode, type ReadingPrefs } from "@/features/reading/lib/prefs";
import { createWarmScheduler, planPrefetch } from "@/features/reading/lib/prefetch-policy";
import { createOnlineSource, type ReaderSource } from "@/features/reading/lib/reader-source";
import { createSegmentFeed, type MutableSegmentFeed } from "@/features/reading/lib/segment-player";
import { buildSegmentTimings, nextSegmentOffset, shiftSegmentWords, type ReceivedSegment } from "@/features/reading/lib/segments";
import { mapAssessedWordsToTokens, nextSentenceIndex, sentenceText, sentenceTokenRange, type TokenRange } from "@/features/reading/lib/sentences";
import { findTokenIndexAtChar, mapWordsToTokens, type WordTiming } from "@/features/reading/lib/tokenize";
import { isAbortError, isStreamUnsupported, isStreamUnsupportedError, markStreamUnsupported } from "@/features/reading/lib/tts-stream";
import { useAudioPlayer } from "@/features/reading/lib/use-audio-player";
import { useSleepTimer } from "@/features/reading/lib/use-sleep-timer";
import { isWebSpeechSupported, speak, speechLangFor, type SpeechHandle } from "@/features/reading/lib/web-speech";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type {
  ReadingAssessedWord,
  ReadingAssessment,
  ReadingCapabilities,
  ReadingLanguage,
  ReadingSectionDetail,
  ReadingSentence,
  ReadingTtsResponse,
  ReadingTtsWord,
  ReadingWarmRequest
} from "@/types/api";

const DEFAULT_SPEEDS = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25];
const AUDIO_CACHE_LIMIT = 6;
const LISTEN_DRAIN_MS = 10_000;

function noop() {}

/** Whole-block audio (offline, or the fallback for servers without the stream). */
interface BlockFileAudio {
  kind: "file";
  tts: ReadingTtsResponse;
  url: string;
  timings: WordTiming[];
}

/** Streamed audio: sentence segments that keep arriving while the block plays. */
interface BlockStreamAudio {
  kind: "stream";
  feed: MutableSegmentFeed;
  received: ReceivedSegment[];
  /** Words of the received segments, on the block timeline. */
  words: ReadingTtsWord[];
  timings: WordTiming[];
  urls: string[];
  controller: AbortController;
}

type BlockAudio = BlockFileAudio | BlockStreamAudio;

function entryWords(entry: BlockAudio): readonly ReadingTtsWord[] {
  return entry.kind === "file" ? entry.tts.words : entry.words;
}

/** Frees the blob URLs of an entry and aborts its stream when still running. */
function releaseEntry(entry: BlockAudio) {
  if (entry.kind === "file") {
    URL.revokeObjectURL(entry.url);
    return;
  }
  entry.controller.abort();
  entry.urls.forEach((url) => URL.revokeObjectURL(url));
}

/** Resolves once the sentence's last word has a time (its segment arrived) or the feed is over. */
function waitForTimings(entry: BlockAudio, range: TokenRange): Promise<void> {
  if (entry.kind === "file" || range.last < 0) {
    return Promise.resolve();
  }
  const ready = () => Number.isFinite(entry.timings[range.last]?.end ?? Number.POSITIVE_INFINITY) || entry.feed.complete;
  if (ready()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const unsubscribe = entry.feed.subscribe(() => {
      if (ready()) {
        unsubscribe();
        resolve();
      }
    });
  });
}

function isLanguageError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "language_unsupported" || error.status === 409);
}

/** How the reader moves between sections: routes online, in-page state offline. */
export interface ReaderNavigation {
  open(sectionId: string): void;
  canOpen(sectionId: string): boolean;
  /** Link (online) or callback (offline) back to the list the reader came from. */
  back: { label: string; href?: string; onClick?: () => void };
  /** Online navigation uses <Link>; offline uses buttons. */
  useLinks: boolean;
}

function SectionNav({ detail, navigation, t }: { detail: ReadingSectionDetail; navigation: ReaderNavigation; t: (key: string) => string }) {
  const previous = detail.previous && navigation.canOpen(detail.previous.id) ? detail.previous : null;
  const next = detail.next && navigation.canOpen(detail.next.id) ? detail.next : null;
  if (!previous && !next) {
    return !detail.previous && !detail.next ? <p className="border-t border-line pt-5 text-sm text-fg-muted">{t("reading.reader.endOfBook")}</p> : null;
  }
  const card =
    "focus-ring group flex min-w-0 flex-col gap-1 rounded-lg border border-line px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-surface-muted";
  const item = (link: { id: string; title: string }, direction: "previous" | "next") => {
    const content = (
      <>
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          {direction === "previous" ? <ChevronLeftIcon size={14} /> : null}
          {direction === "previous" ? t("reading.reader.previous") : t("reading.reader.next")}
          {direction === "next" ? <ChevronRightIcon size={14} /> : null}
        </span>
        <span className="max-w-full truncate text-sm font-medium text-primary">{link.title}</span>
      </>
    );
    const className = cn(card, direction === "next" && "sm:items-end sm:text-right");
    return navigation.useLinks ? (
      <Link href={buildReaderHref(link.id)} className={className}>
        {content}
      </Link>
    ) : (
      <button type="button" className={className} onClick={() => navigation.open(link.id)}>
        {content}
      </button>
    );
  };
  return (
    <nav aria-label={t("reading.reader.navigation")} className="grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
      {previous ? item(previous, "previous") : <span aria-hidden className="hidden sm:block" />}
      {next ? item(next, "next") : null}
    </nav>
  );
}

/** Current sentence (by `ReadingSentence.index`) and last assessment of the drill / listen-and-repeat. */
interface DrillState {
  blockKey: string;
  sentence: number;
  result: ReadingAssessment | null;
}

export interface ReaderViewProps {
  detail: ReadingSectionDetail;
  capabilities: ReadingCapabilities | undefined;
  /** Audio and timings: the API or the offline store. */
  source: ReaderSource;
  navigation: ReaderNavigation;
}

/** The interactive reader once the section and the capabilities are known (online or offline). */
export function ReaderView({ detail, capabilities, source, navigation }: ReaderViewProps) {
  const { t } = useI18n();
  const online = source.kind === "online";
  const isOnline = useOnlineStatus();
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
  // Book language: the neural voice and the assessment only exist for English (409 otherwise).
  const [languageRejected, setLanguageRejected] = useState(false);
  const language: ReadingLanguage = detail.language ?? (languageRejected ? "unknown" : "en");
  const englishBook = language === "en" && !languageRejected;
  const speechLang = speechLangFor(language);
  const assessAvailable = online && englishBook && Boolean(capabilities?.assess?.available);
  const aiAvailable = online && Boolean(capabilities?.ai?.available);
  // The glossary works without AI too (IPA + audio); it needs an Increment 2 API (`ai` in capabilities).
  const glossaryAvailable = online && capabilities?.ai !== undefined;
  const voices = ttsCapability?.voices ?? [];
  const speeds = ttsCapability?.speeds?.length ? ttsCapability.speeds : DEFAULT_SPEEDS;
  const voice = prefs.voice && voices.some((item) => item.id === prefs.voice) ? prefs.voice : (ttsCapability?.default_voice ?? voices[0]?.id ?? null);
  const speed = speeds.includes(prefs.speed) ? prefs.speed : speeds.includes(1) ? 1 : (speeds[0] ?? 1);
  const mode: ReaderMode = (prefs.mode === "shadow" || prefs.mode === "drill" || prefs.mode === "repeat") && assessAvailable ? prefs.mode : "listen";
  const glossaryTap = glossaryAvailable && prefs.glossaryTap;

  const [engineOverride, setEngineOverride] = useState<ReaderEngine | null>(null);
  const engine: ReaderEngine = englishBook ? (engineOverride ?? (ttsAvailable ? "tts" : "browser")) : "browser";
  // Streamed TTS unless the server says no (or answered 404/405 earlier in this session).
  const streamingAllowed = online && Boolean(source.loadStream) && ttsCapability?.streaming !== false && !isStreamUnsupported();
  const webSpeechSupported = typeof window !== "undefined" && isWebSpeechSupported();
  const [notice, setNotice] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Active block (resume from saved progress once per section).
  const [activeIndex, setActiveIndex] = useState(() => findBlockIndex(blocks, detail.progress?.part_id, detail.progress?.block_index));
  const [resumed] = useState(() => activeIndex > 0);
  const activeBlock: ReaderBlock | undefined = blocks[activeIndex];

  // Progress reporting.
  const progress = useProgressReporter({ bookSlug: detail.book_slug, sectionId: detail.section_id, enabled: online });
  const progressMode = mode === "listen" ? "listen" : "shadow";

  // Neural audio cache keyed by section + block + voice + speed (blob URLs revoked on eviction and
  // unmount; running streams aborted). Streamed segments are also kept by the stream module in the
  // react-query cache, so the next section's first block survives the navigation.
  const audioCacheRef = useRef(new Map<string, BlockAudio>());
  /** Cache key of the entry currently loaded in the player. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    loadedKeyRef.current = loadedKey;
  }, [loadedKey]);
  const [audioLoading, setAudioLoading] = useState(false);
  /** Pushes refreshed word timings into the player (bound once the player exists). */
  const timingsSinkRef = useRef<(timings: WordTiming[]) => void>(noop);

  useEffect(() => {
    const cache = audioCacheRef.current;
    return () => {
      cache.forEach((entry) => releaseEntry(entry));
      cache.clear();
    };
  }, []);

  const ttsParamsFor = useCallback(
    (block: ReaderBlock, sectionId: string = detail.section_id): TtsParams => ({ sectionId, partId: block.partId, blockIndex: block.blockIndex, voice, speed }),
    [detail.section_id, speed, voice]
  );
  const settingsSuffix = `|${voice ?? ""}|${speed}`;
  const cacheKeyFor = useCallback((block: ReaderBlock, sectionId: string = detail.section_id) => `${sectionId}|${block.key}${settingsSuffix}`, [detail.section_id, settingsSuffix]);

  const switchToBrowser = useCallback(
    (reason: string | null) => {
      setEngineOverride("browser");
      setNotice(webSpeechSupported ? (reason === "speech_warming" ? t("reading.capabilities.ttsWarming") : t("reading.reader.fallbackNotice")) : t("reading.reader.fallbackUnsupported"));
    },
    [t, webSpeechSupported]
  );

  const storeEntry = useCallback((key: string, entry: BlockAudio) => {
    const cache = audioCacheRef.current;
    if (cache.size >= AUDIO_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        const evicted = cache.get(oldest);
        cache.delete(oldest);
        if (evicted && oldest !== loadedKeyRef.current) {
          releaseEntry(evicted);
        }
      }
    }
    cache.set(key, entry);
  }, []);

  /** Whole-block path: TTS + audio blob; retries the TTS once on `audio_not_found`. */
  const loadBlockFile = useCallback(
    async (params: TtsParams, block: ReaderBlock): Promise<BlockFileAudio> => {
      let tts = await source.loadTts(params);
      let blob: Blob;
      try {
        blob = await source.loadAudio(tts);
      } catch (error) {
        if (source.isStaleAudioError(error)) {
          tts = await source.loadTts(params, { force: true });
          blob = await source.loadAudio(tts);
        } else {
          throw error;
        }
      }
      return { kind: "file", tts, url: URL.createObjectURL(blob), timings: mapWordsToTokens(tts.words, block.tokens) };
    },
    [source]
  );

  /**
   * Streamed path: resolves once the stream started (its `meta` line arrived); the segments keep
   * filling the entry's feed and timings afterwards. Rejects like the HTTP request does.
   */
  const loadBlockStream = useCallback(
    async (params: TtsParams, block: ReaderBlock, key: string): Promise<BlockStreamAudio> => {
      const loadStream = source.loadStream;
      if (!loadStream) {
        throw new Error("stream unavailable");
      }
      const entry: BlockStreamAudio = {
        kind: "stream",
        feed: createSegmentFeed(),
        received: [],
        words: [],
        timings: buildSegmentTimings([], block.tokens),
        urls: [],
        controller: new AbortController()
      };
      let resolveMeta: () => void = noop;
      const metaReady = new Promise<void>((resolve) => {
        resolveMeta = resolve;
      });
      const run = loadStream(params, {
        signal: entry.controller.signal,
        onMeta: () => resolveMeta(),
        onSegment: (segment, blob) => {
          const url = URL.createObjectURL(blob);
          const offset = nextSegmentOffset(entry.feed.segments);
          const received: ReceivedSegment = {
            url,
            duration: segment.duration_seconds,
            offset,
            index: segment.index,
            charStart: segment.char_start,
            charEnd: segment.char_end,
            words: shiftSegmentWords(segment, offset)
          };
          entry.urls.push(url);
          entry.received.push(received);
          entry.words.push(...received.words);
          entry.timings = buildSegmentTimings(entry.received, block.tokens);
          if (loadedKeyRef.current === key) {
            timingsSinkRef.current(entry.timings);
          }
          entry.feed.push({ url, duration: segment.duration_seconds, offset });
        }
      });
      run.then(
        () => entry.feed.finish(),
        (error: unknown) => {
          entry.feed.fail(error);
          // Forget a failed stream so the next attempt starts over.
          if (audioCacheRef.current.get(key) === entry) {
            audioCacheRef.current.delete(key);
            if (loadedKeyRef.current !== key) {
              releaseEntry(entry);
            }
          }
        }
      );
      await Promise.race([metaReady, run]);
      return entry;
    },
    [source]
  );

  /**
   * Resolves (and caches) the audio of a block: streamed when possible, whole file otherwise.
   * `background` (prefetch) never changes the engine or shows notices; it just gives up.
   */
  const ensureAudio = useCallback(
    async (block: ReaderBlock, options: { sectionId?: string; background?: boolean } = {}): Promise<BlockAudio | null> => {
      const sectionId = options.sectionId ?? detail.section_id;
      const key = cacheKeyFor(block, sectionId);
      const cached = audioCacheRef.current.get(key);
      if (cached) {
        return cached;
      }
      const params = ttsParamsFor(block, sectionId);
      try {
        let entry: BlockAudio;
        if (streamingAllowed) {
          try {
            entry = await loadBlockStream(params, block, key);
          } catch (error) {
            if (!isStreamUnsupportedError(error)) {
              throw error;
            }
            // Older server without the stream route: block mode for the rest of the session.
            markStreamUnsupported();
            entry = await loadBlockFile(params, block);
          }
        } else {
          entry = await loadBlockFile(params, block);
        }
        storeEntry(key, entry);
        return entry;
      } catch (error) {
        if (isAbortError(error)) {
          return null;
        }
        if (options.background) {
          return null;
        }
        if (isLanguageError(error)) {
          setLanguageRejected(true);
          return null;
        }
        if (error instanceof ApiError && (error.code === "speech_unavailable" || error.code === "speech_warming" || error.status === 503)) {
          switchToBrowser(error.code);
          return null;
        }
        throw error;
      }
    },
    [cacheKeyFor, detail.section_id, loadBlockFile, loadBlockStream, storeEntry, streamingAllowed, switchToBrowser, ttsParamsFor]
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
  const pauseAllRef = useRef<() => void>(() => {});

  const sleep = useSleepTimer({
    onVolume: (volume) => playerRef.current.setVolume(volume),
    onExpire: () => pauseAllRef.current()
  });
  const { consumeEndOfSection } = sleep;

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
    } else if (consumeEndOfSection()) {
      // Sleep timer "end of section": stop here.
    } else if (next && navigation.canOpen(next.id)) {
      void progress.flush().then(() => navigation.open(next.id));
    }
  }, [activeIndex, blocks, consumeEndOfSection, detail.next, navigation, progress]);

  const player = useAudioPlayer({
    playbackRate: 1,
    onEnded: handleBlockEnded,
    onError: () => setAudioError(t("reading.reader.audioFailed"))
  });
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
    timingsSinkRef.current = player.setTimings;
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
            lang: speechLang,
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
        const key = cacheKeyFor(block);
        loadedKeyRef.current = key;
        setLoadedKey(key);
        if (entry.kind === "file") {
          await playerRef.current.load(entry.url, entry.timings, { autoplay });
        } else {
          playerRef.current.loadSegments(entry.feed, entry.timings, { autoplay });
        }
      } catch {
        setAudioError(t("reading.reader.audioFailed"));
      } finally {
        setAudioLoading(false);
      }
    },
    [blocks, cacheKeyFor, engine, ensureAudio, handleBlockEnded, progress, speechLang, speed, stopSpeech, t, webSpeechSupported]
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
    // Streams still running for the previous voice/speed are no longer wanted.
    audioCacheRef.current.forEach((entry, entryKey) => {
      if (entry.kind === "stream" && !entry.feed.complete && !entryKey.endsWith(settingsSuffix)) {
        audioCacheRef.current.delete(entryKey);
        releaseEntry(entry);
      }
    });
    const wasPlaying = playerRef.current.state.status === "playing" || playerRef.current.state.status === "buffering" || speechPlaying;
    goTo(activeIndex, wasPlaying);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the settings key
  }, [voice, speed, engine]);

  const playerStatus = player.state.status;
  const isPlaying = engine === "browser" ? speechPlaying : playerStatus === "playing" || playerStatus === "buffering";
  // The very first sentence still on its way counts as loading; later gaps are the discreet indicator.
  const firstSegmentPending = playerStatus === "buffering" && player.state.segmentIndex < 0 && player.state.currentTime === 0;
  const isLoading = audioLoading || (engine === "tts" && (playerStatus === "loading" || firstSegmentPending));
  const isBuffering = engine === "tts" && playerStatus === "buffering" && !firstSegmentPending;
  const canPlay = engine === "tts" || webSpeechSupported;

  // Anticipation: while a block plays, stream the next one (one ahead); on the last block, the next
  // section and its first block, so the navigation finds everything in the caches.
  const prefetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!online || engine !== "tts" || playerStatus !== "playing") {
      return;
    }
    const plan = planPrefetch({ activeIndex, blockCount: blocks.length, nextSectionId: detail.next?.id ?? null });
    if (!plan) {
      return;
    }
    const planKey = plan.kind === "block" ? cacheKeyFor(blocks[plan.index]) : `${plan.sectionId}${settingsSuffix}`;
    if (prefetchedRef.current === planKey) {
      return;
    }
    prefetchedRef.current = planKey;
    // Deferred: a status flip back and forth within the same tick must not start a stream.
    const timer = globalThis.setTimeout(() => {
      if (plan.kind === "block") {
        void ensureAudio(blocks[plan.index], { background: true }).catch(noop);
        return;
      }
      const loadSection = source.loadSection;
      if (!loadSection || !navigation.canOpen(plan.sectionId)) {
        return;
      }
      void loadSection(plan.sectionId)
        .then((next) => {
          const first = flattenBlocks(next)[0];
          if (first && (next.language ?? "en") === "en") {
            return ensureAudio(first, { sectionId: next.section_id, background: true });
          }
          return null;
        })
        .catch(noop);
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [activeIndex, blocks, cacheKeyFor, detail.next?.id, engine, ensureAudio, navigation, online, playerStatus, settingsSuffix, source.loadSection]);

  // Warm-up: on open and on each voice/speed change, ask the server to synthesise the next blocks
  // (debounced 2 s, at most once a minute per section; errors ignored).
  const warmRef = useRef(createWarmScheduler<ReadingWarmRequest>(noop));
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);
  const warmSend = source.warm;
  useEffect(() => {
    const scheduler = createWarmScheduler<ReadingWarmRequest>((sectionId, body) => {
      warmSend?.(sectionId, body).catch(noop);
    });
    warmRef.current = scheduler;
    return () => scheduler.cancel();
  }, [warmSend]);
  const warmEnabled = online && Boolean(warmSend) && Boolean(capabilities?.warm?.enabled) && englishBook && engine === "tts";
  useEffect(() => {
    if (!warmEnabled) {
      return;
    }
    const block = blocks[activeIndexRef.current];
    if (!block) {
      return;
    }
    const body: ReadingWarmRequest = { part_id: block.partId, block_index: block.blockIndex, speed };
    if (voice) {
      body.voice = voice;
    }
    warmRef.current.request(detail.section_id, body);
  }, [blocks, detail.section_id, speed, voice, warmEnabled]);

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
        if (timing && Number.isFinite(timing.start)) {
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
        const match = entry ? entryWords(entry).find((item) => item.char_start < word.char_end && word.char_start < item.char_end) : undefined;
        if (match) {
          void playerRef.current.playRange(Math.max(0, match.start - 0.05), match.end + 0.12);
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
  useEffect(() => {
    pauseAllRef.current = pauseAll;
  }, [pauseAll]);

  // Sentence drill / listen and repeat: the current sentence of the active block and the last
  // assessment (for the marks in the text).
  const [drill, setDrill] = useState<DrillState | null>(null);
  const practiceMode = mode === "drill" || mode === "repeat";
  const drillSentence = activeBlock ? (drill && drill.blockKey === activeBlock.key ? drill.sentence : (activeBlock.sentences[0]?.index ?? 0)) : 0;
  const drillResult = activeBlock && drill && drill.blockKey === activeBlock.key && drill.sentence === drillSentence ? drill.result : null;
  const drillSentenceObject = activeBlock?.sentences.find((sentence) => sentence.index === drillSentence) ?? activeBlock?.sentences[0];
  const drillRange = useMemo(
    () => (practiceMode && activeBlock && drillSentenceObject ? sentenceTokenRange(activeBlock.tokens, drillSentenceObject) : null),
    [activeBlock, drillSentenceObject, practiceMode]
  );
  const drillMarks = useMemo(() => {
    if (!practiceMode || !activeBlock || !drillResult) {
      return null;
    }
    const offset = drillResult.char_offset ?? drillSentenceObject?.char_start ?? 0;
    return mapAssessedWordsToTokens(drillResult.words, offset, activeBlock.tokens);
  }, [activeBlock, drillResult, drillSentenceObject, practiceMode]);

  const advanceDrill = useCallback(() => {
    if (!activeBlock) {
      return;
    }
    const next = nextSentenceIndex(activeBlock.sentences, drillSentence);
    if (next !== null) {
      setDrill({ blockKey: activeBlock.key, sentence: next, result: null });
    } else if (activeIndex + 1 < blocks.length) {
      progress.addWords(activeBlock.tokens.length);
      goTo(activeIndex + 1, false);
    }
  }, [activeBlock, activeIndex, blocks.length, drillSentence, goTo, progress]);

  /** Plays the model audio of one sentence of the active block; resolves when it ends. */
  const playSentenceOf = useCallback(
    async (sentence: ReadingSentence | undefined): Promise<void> => {
      if (!activeBlock || !sentence) {
        return;
      }
      if (engine !== "tts") {
        stopSpeech();
        if (!webSpeechSupported) {
          return;
        }
        await new Promise<void>((resolve, reject) => {
          speechRef.current = speak({
            text: sentenceText(activeBlock.text, sentence),
            rate: speed,
            lang: speechLang,
            onEnd: resolve,
            onError: (event) => reject(event)
          });
        });
        return;
      }
      setModelBusy(true);
      try {
        if (!activeLoaded) {
          await loadBlock(activeIndex, false);
        }
        const entry = audioCacheRef.current.get(cacheKeyFor(activeBlock));
        if (!entry) {
          return;
        }
        const range = sentenceTokenRange(activeBlock.tokens, sentence);
        await waitForTimings(entry, range);
        const first = entry.timings[range.first];
        const last = entry.timings[range.last];
        if (first && last && Number.isFinite(first.start) && Number.isFinite(last.end)) {
          setModelBusy(false);
          await playerRef.current.playRange(Math.max(0, first.start - 0.05), last.end + 0.15);
        }
      } finally {
        setModelBusy(false);
      }
    },
    [activeBlock, activeIndex, activeLoaded, cacheKeyFor, engine, loadBlock, speechLang, speed, stopSpeech, webSpeechSupported]
  );
  const playSentence = useCallback(() => playSentenceOf(drillSentenceObject), [drillSentenceObject, playSentenceOf]);

  /** Model duration of a sentence (seconds) from the loaded timings, when known. */
  const sentenceDuration = useCallback(
    (position: number): number | null => {
      const sentence = activeBlock?.sentences[position];
      if (!activeBlock || !sentence) {
        return null;
      }
      const entry = audioCacheRef.current.get(cacheKeyFor(activeBlock));
      const range = sentenceTokenRange(activeBlock.tokens, sentence);
      const first = entry?.timings[range.first];
      const last = entry?.timings[range.last];
      if (!first || !last || !Number.isFinite(first.start) || !Number.isFinite(last.end)) {
        return null;
      }
      return Math.max(0, last.end - first.start);
    },
    [activeBlock, cacheKeyFor]
  );

  // Listen and repeat continues into the next block by itself once a block is complete.
  const [repeatContinuing, setRepeatContinuing] = useState(false);
  const finishRepeatBlock = useCallback(() => {
    if (!activeBlock || activeIndex + 1 >= blocks.length) {
      return;
    }
    progress.addWords(activeBlock.tokens.length);
    setRepeatContinuing(true);
    goTo(activeIndex + 1, false);
  }, [activeBlock, activeIndex, blocks.length, goTo, progress]);
  const exitRepeat = useCallback(() => {
    setRepeatContinuing(false);
    pauseAll();
    updatePrefs({ mode: "listen" });
  }, [pauseAll, updatePrefs]);

  // Glossary popover.
  const [glossary, setGlossary] = useState<(GlossaryTarget & { blockKey: string; tokenIndex: number }) | null>(null);
  const openGlossary = useCallback(
    (blockIndex: number, tokenIndex: number) => {
      const block = blocks[blockIndex];
      const token = block?.tokens[tokenIndex];
      if (!block || !token || !glossaryAvailable) {
        return;
      }
      setGlossary({
        blockKey: block.key,
        tokenIndex,
        word: token.text,
        ref: { section_id: detail.section_id, part_id: block.partId, block_index: block.blockIndex, char_start: token.start, char_end: token.end }
      });
    },
    [blocks, detail.section_id, glossaryAvailable]
  );
  const playGlossaryFromBlock = useCallback(() => {
    if (!glossary || engine !== "tts") {
      return false;
    }
    const block = blocks.find((item) => item.key === glossary.blockKey);
    if (!block || loadedKey !== cacheKeyFor(block)) {
      return false;
    }
    const timing = audioCacheRef.current.get(cacheKeyFor(block))?.timings[glossary.tokenIndex];
    if (!timing || !timing.matched || !Number.isFinite(timing.start)) {
      return false;
    }
    void playerRef.current.playRange(Math.max(0, timing.start - 0.05), timing.end + 0.12);
    return true;
  }, [blocks, cacheKeyFor, engine, glossary, loadedKey]);

  // Keyboard: space (play/pause), arrows (blocks). `R` belongs to the shadow panel.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      if (event.key === " " || event.code === "Space") {
        if (mode === "repeat") {
          // The listen-and-repeat panel owns Space (pause/resume the loop).
          return;
        }
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
  }, [activeIndex, blocks, goTo, isPlaying, mode, progress, togglePlayback]);

  // Media Session (lock screen, headset): handlers read the latest callbacks through a ref.
  const mediaHandlersRef = useRef<MediaSessionHandlers>({ play: noop, pause: noop, previous: noop, next: noop, seekBy: noop });
  useEffect(() => {
    mediaHandlersRef.current = {
      play: () => {
        if (!isPlaying) {
          togglePlayback();
        }
      },
      pause: () => pauseAll(),
      previous: () => goTo(activeIndex - 1, isPlaying),
      next: () => {
        if (activeBlock) {
          progress.addWords(activeBlock.tokens.length);
        }
        goTo(activeIndex + 1, isPlaying);
      },
      seekBy: (seconds: number) => {
        if (engine !== "tts" || !activeLoaded) {
          return;
        }
        const times = playerRef.current.getTimes();
        const target = Math.min(Math.max(0, times.currentTime + seconds), Math.max(0, times.duration - 0.05));
        playerRef.current.seek(target);
      }
    };
  });
  const bookTitleText = detail.book_title;
  const chapterTitleText = detail.chapter_title || detail.breadcrumb[0] || "";
  useEffect(
    () =>
      bindMediaSession(
        { title: detail.title, artist: bookTitleText, album: chapterTitleText },
        {
          play: () => mediaHandlersRef.current.play(),
          pause: () => mediaHandlersRef.current.pause(),
          previous: () => mediaHandlersRef.current.previous(),
          next: () => mediaHandlersRef.current.next(),
          seekBy: (seconds) => mediaHandlersRef.current.seekBy(seconds)
        }
      ),
    [bookTitleText, chapterTitleText, detail.title]
  );
  useEffect(() => {
    setMediaPlaybackState(isPlaying ? "playing" : "paused");
  }, [isPlaying]);
  useEffect(() => {
    if (engine === "tts" && activeLoaded) {
      const times = playerRef.current.getTimes();
      setMediaPosition(times.duration, times.currentTime, times.playbackRate);
    }
  }, [activeLoaded, engine, player.state.currentTime, player.state.duration, player.state.status]);

  const currentWordIndex = engine === "browser" ? speechWordIndex : activeLoaded ? player.state.currentWordIndex : -1;
  const positionPercent = detail.position.total > 0 ? (detail.position.index / detail.position.total) * 100 : 0;
  const bookTitle = bookTitleText;
  const chapterTitle = chapterTitleText;
  const backClass = "focus-ring -ml-1 inline-flex items-center gap-1.5 self-start rounded-sm px-1 text-sm text-fg-muted hover:text-fg";

  return (
    <>
      <Page width="reading" className="pb-8">
        <header className="flex flex-col gap-3">
          {navigation.back.href ? (
            <Link href={navigation.back.href} className={backClass}>
              <ArrowLeftIcon />
              {navigation.back.label}
            </Link>
          ) : (
            <button type="button" onClick={navigation.back.onClick} className={backClass}>
              <ArrowLeftIcon />
              {navigation.back.label}
            </button>
          )}
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

        {!isOnline ? <Alert tone="neutral" message={online ? t("reading.reader.offlineIndicator") : t("reading.offline.readerNotice")} /> : null}
        {!englishBook ? (
          <Alert
            tone="warning"
            title={t("reading.capabilities.languageTitle", { language: t(`reading.capabilities.languages.${language}`) })}
            message={t("reading.capabilities.languageNotice")}
          />
        ) : null}
        {notice && englishBook ? <Alert tone="warning" message={notice} /> : null}
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
                  onWordGlossary={glossaryAvailable ? (tokenIndex) => openGlossary(index, tokenIndex) : undefined}
                  glossaryTap={glossaryTap}
                  highlight={isActive ? drillRange : null}
                  marks={isActive ? drillMarks : null}
                />
                {isActive && mode === "drill" && activeBlock ? (
                  <DrillPanel
                    sectionId={detail.section_id}
                    block={activeBlock}
                    sentenceIndex={drillSentence}
                    assessAvailable={assessAvailable}
                    maxSeconds={capabilities?.assess?.max_seconds || undefined}
                    onListenSentence={() => void playSentence()}
                    onPlayWord={(word) => void playModelWord(word)}
                    modelBusy={modelBusy}
                    onBeforeRecord={pauseAll}
                    onResult={(assessment) => setDrill({ blockKey: activeBlock.key, sentence: drillSentence, result: assessment })}
                    onAdvance={advanceDrill}
                  />
                ) : null}
                {isActive && mode === "repeat" && activeBlock ? (
                  <ListenRepeatPanel
                    sectionId={detail.section_id}
                    block={activeBlock}
                    hasNextBlock={activeIndex + 1 < blocks.length}
                    assessAvailable={assessAvailable}
                    playSentence={(position) => playSentenceOf(activeBlock.sentences[position])}
                    stopModel={pauseAll}
                    sentenceDuration={sentenceDuration}
                    onPlayWord={(word) => void playModelWord(word)}
                    modelBusy={modelBusy}
                    onSentenceChange={(sentenceIndex, assessment) => setDrill({ blockKey: activeBlock.key, sentence: sentenceIndex, result: assessment })}
                    onBlockDone={finishRepeatBlock}
                    onExit={exitRepeat}
                    autoStart={repeatContinuing}
                  />
                ) : null}
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

        <ComprehensionCard sectionId={detail.section_id} aiAvailable={aiAvailable} />

        <p className="sr-only">{t("reading.reader.shortcuts")}</p>
        <SectionNav detail={detail} navigation={navigation} t={t} />
      </Page>

      {glossaryAvailable ? (
        <GlossaryPopover target={glossary} onClose={() => setGlossary(null)} playFromBlock={playGlossaryFromBlock} voice={voice} />
      ) : null}

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
          if (value !== "listen") {
            pauseAll();
          }
          if (value !== "repeat") {
            setRepeatContinuing(false);
          }
          updatePrefs({ mode: value });
        }}
        shadowEnabled={assessAvailable}
        drillEnabled={online ? assessAvailable : undefined}
        repeatEnabled={online ? assessAvailable : undefined}
        modesDisabledReason={!englishBook ? t("reading.player.modeNeedsEnglish") : undefined}
        buffering={isBuffering}
        glossaryAvailable={glossaryAvailable}
        glossaryTap={glossaryTap}
        onGlossaryTapChange={(value) => updatePrefs({ glossaryTap: value })}
        sleepOption={sleep.option}
        onSleepOptionChange={sleep.setOption}
        sleepRemainingSeconds={sleep.remainingSeconds}
      />
    </>
  );
}

/** `/read/s/[sectionId]`: listen, read along and shadow one book section. */
export function Reader({ sectionId }: { sectionId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const section = useReadingSectionQuery(sectionId);
  const capabilities = useReadingCapabilitiesQuery();
  const source = useMemo(() => createOnlineSource(queryClient), [queryClient]);
  const bookSlug = section.data?.book_slug ?? "";
  const navigation = useMemo<ReaderNavigation>(
    () => ({
      open: (id) => router.push(buildReaderHref(id)),
      canOpen: () => true,
      back: { label: t("reading.reader.backToBook"), href: buildBookHref(bookSlug) },
      useLinks: true
    }),
    [bookSlug, router, t]
  );

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

  return <ReaderView key={sectionId} detail={section.data} capabilities={capabilities.data} source={source} navigation={navigation} />;
}
