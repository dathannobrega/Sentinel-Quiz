"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CircleCheckIcon, PlusSquareIcon, VolumeIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWordAudio, markGlossaryInDeck, useAddWordMutation } from "@/features/reading/hooks";
import { isWebSpeechSupported, speak } from "@/features/reading/lib/web-speech";
import { apiClient, ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { queryKeys } from "@/lib/query/keys";
import type { ReadingGlossaryEntry, ReadingWordRef } from "@/types/api";

export interface GlossaryTarget {
  ref: ReadingWordRef;
  /** The word as displayed (title while loading). */
  word: string;
}

export interface GlossaryPopoverProps {
  target: GlossaryTarget | null;
  onClose: () => void;
  /** Plays the word from the block audio when that audio is loaded; returns false otherwise. */
  playFromBlock?: (target: GlossaryTarget) => boolean;
  voice?: string | null;
}

/** Message for a glossary / add-word failure (429 quota, 502 AI failure). */
export function describeGlossaryError(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === "reading_ai_quota_exceeded") {
      return t("reading.glossary.errors.quota");
    }
    if (error.status === 502 || error.code === "reading_ai_failed") {
      return t("reading.glossary.errors.aiFailed");
    }
  }
  return t("reading.glossary.errors.generic");
}

/**
 * Word glossary (modal dialog: focus trap, Esc closes, focus returns to the word): IPA, audio,
 * pt-BR translation, definition, explanation in context, examples and "Add to my words".
 */
export function GlossaryPopover({ target, onClose, playFromBlock, voice }: GlossaryPopoverProps) {
  const { t } = useI18n();
  const client = useQueryClient();
  const ref = target?.ref;
  const query = useQuery({
    queryKey: ref ? queryKeys.readingGlossary(ref.section_id, ref.part_id, ref.block_index, ref.char_start, ref.char_end) : ["reading", "glossary", "none"],
    queryFn: ({ signal }) => apiClient.post<ReadingGlossaryEntry>("/reading/glossary", ref, { signal, timeoutMs: 60_000 }),
    enabled: Boolean(ref),
    staleTime: 30 * 60_000,
    retry: false
  });
  const addWord = useAddWordMutation();
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    };
  }, []);

  // A new word resets the transient state.
  const targetKey = ref ? `${ref.section_id}|${ref.part_id}|${ref.block_index}|${ref.char_start}` : "";
  const targetKeyRef = useRef(targetKey);
  useEffect(() => {
    if (targetKeyRef.current !== targetKey) {
      targetKeyRef.current = targetKey;
      setPlayError(false);
      addWord.reset();
    }
  }, [addWord, targetKey]);

  const entry = query.data;
  const word = entry?.word || target?.word || "";

  async function play() {
    if (!target) {
      return;
    }
    setPlayError(false);
    if (entry?.card_id) {
      setPlaying(true);
      try {
        const blob = await fetchWordAudio(entry.card_id, { voice });
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current);
        }
        urlRef.current = URL.createObjectURL(blob);
        audioRef.current?.pause();
        const audio = new Audio(urlRef.current);
        audioRef.current = audio;
        await audio.play();
        return;
      } catch {
        // Fall through to the block audio or the browser voice.
      } finally {
        setPlaying(false);
      }
    }
    if (playFromBlock?.(target)) {
      return;
    }
    if (isWebSpeechSupported()) {
      speak({ text: word, rate: 0.9 });
      return;
    }
    setPlayError(true);
  }

  function add() {
    if (!ref) {
      return;
    }
    addWord.mutate(
      { ...ref, kind: "vocabulary" },
      {
        onSuccess: (card) => markGlossaryInDeck(client, ref, card)
      }
    );
  }

  const inDeck = Boolean(entry?.in_deck || addWord.isSuccess);

  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      title={word}
      description={entry?.ipa ? <span className="font-ipa">/{entry.ipa}/</span> : undefined}
      showCloseButton
      footer={
        <>
          <Button variant="secondary" onClick={() => void play()} busy={playing} aria-label={t("reading.glossary.playWord", { word })}>
            <VolumeIcon />
            {t("reading.glossary.play")}
          </Button>
          {inDeck ? (
            <Link href="/read/words" className="focus-ring inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-success">
              <CircleCheckIcon />
              {t("reading.glossary.inDeck")}
            </Link>
          ) : (
            <Button onClick={add} busy={addWord.isPending} disabled={!ref || query.isPending}>
              <PlusSquareIcon />
              {t("reading.glossary.add")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm" aria-live="polite" aria-busy={query.isPending || undefined}>
        {query.isPending ? (
          <>
            <span className="sr-only" role="status">
              {t("reading.glossary.loading")}
            </span>
            <Skeleton height={16} className="max-w-48" />
            <Skeleton height={48} />
          </>
        ) : query.isError ? (
          <Alert tone="danger" role="alert" message={describeGlossaryError(query.error, t)} />
        ) : entry ? (
          <>
            {entry.part_of_speech || (entry.lemma && entry.lemma !== entry.word) ? (
              <p className="text-xs text-fg-muted">
                {[entry.part_of_speech, entry.lemma && entry.lemma !== entry.word ? t("reading.glossary.lemma", { lemma: entry.lemma }) : null].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {entry.source === "none" ? (
              <Alert tone="neutral" message={t("reading.glossary.aiOff")} />
            ) : (
              <dl className="flex flex-col gap-3">
                {entry.translation_pt ? (
                  <div>
                    <dt className="text-xs font-semibold text-fg-muted">{t("reading.glossary.translation")}</dt>
                    <dd className="text-base font-medium text-fg">{entry.translation_pt}</dd>
                  </div>
                ) : null}
                {entry.definition_en ? (
                  <div>
                    <dt className="text-xs font-semibold text-fg-muted">{t("reading.glossary.definition")}</dt>
                    <dd lang="en" className="text-fg">
                      {entry.definition_en}
                    </dd>
                  </div>
                ) : null}
                {entry.context_explanation_pt ? (
                  <div>
                    <dt className="text-xs font-semibold text-fg-muted">{t("reading.glossary.context")}</dt>
                    <dd className="text-fg">{entry.context_explanation_pt}</dd>
                  </div>
                ) : null}
                {entry.examples.length ? (
                  <div>
                    <dt className="text-xs font-semibold text-fg-muted">{t("reading.glossary.examples")}</dt>
                    <dd>
                      <ul lang="en" className="mt-1 flex list-disc flex-col gap-1 pl-5 font-serif text-fg">
                        {entry.examples.map((example) => (
                          <li key={example}>{example}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
          </>
        ) : null}
        {playError ? <p className="text-xs text-danger">{t("reading.glossary.playFailed")}</p> : null}
        {addWord.isError ? <Alert tone="danger" role="alert" message={describeGlossaryError(addWord.error, t)} /> : null}
        {addWord.isSuccess ? (
          <p role="status" className="text-xs text-success">
            {t("reading.glossary.added")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
