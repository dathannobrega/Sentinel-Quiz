"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, CircleCheckIcon, MicIcon, MicOffIcon, StopIcon, WaveIcon } from "@/components/ui/icons";
import { Panel } from "@/components/ui/section";
import { AssessmentResult } from "@/features/reading/components/assessment-result";
import { describeAssessError } from "@/features/reading/components/shadow-panel";
import { useAssessMutation } from "@/features/reading/hooks";
import type { ReaderBlock } from "@/features/reading/lib/blocks";
import { isRecordingSupported, MAX_RECORDING_SECONDS } from "@/features/reading/lib/recorder";
import { DRILL_MAX_TRIES, DRILL_PASS_SCORE, sentenceText, shiftWords } from "@/features/reading/lib/sentences";
import { usePhonemesOffReason, useMyRecording } from "@/features/reading/lib/use-my-recording";
import { describeRecordingError, useRecording } from "@/features/reading/lib/use-recording";
import { useI18n } from "@/lib/i18n";
import type { ReadingAssessedWord, ReadingAssessment } from "@/types/api";

/** Delay before moving on after a passing attempt (lets the learner see the score). */
export const DRILL_ADVANCE_DELAY_MS = 1_500;

export interface DrillPanelProps {
  sectionId: string;
  block: ReaderBlock;
  /** `index` of the current sentence in `block.sentences`. */
  sentenceIndex: number;
  assessAvailable: boolean;
  maxSeconds?: number;
  /** Plays the model audio of the current sentence. */
  onListenSentence: () => void;
  /** Plays the model audio of one word (offsets relative to the block). */
  onPlayWord: (word: ReadingAssessedWord) => void;
  modelBusy: boolean;
  onBeforeRecord: () => void;
  /** Latest assessment of this sentence (null when cleared), to mark the words in the block. */
  onResult: (assessment: ReadingAssessment | null) => void;
  /** Next sentence (or the next block after the last one). */
  onAdvance: () => void;
}

/** Sentence drill: record one sentence at a time; passes at 85 %, offers to move on after 3 tries. */
export function DrillPanel({
  sectionId,
  block,
  sentenceIndex,
  assessAvailable,
  maxSeconds = MAX_RECORDING_SECONDS,
  onListenSentence,
  onPlayWord,
  modelBusy,
  onBeforeRecord,
  onResult,
  onAdvance
}: DrillPanelProps) {
  const { t } = useI18n();
  const assess = useAssessMutation(sectionId);
  const [result, setResult] = useState<ReadingAssessment | null>(null);
  const mine = useMyRecording();
  const { setRecording: keepRecording } = mine;
  const phonemesOffReason = usePhonemesOffReason();
  const [tries, setTries] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [passed, setPassed] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supported = typeof window !== "undefined" ? isRecordingSupported() : true;
  const callbacksRef = useRef({ onResult, onAdvance });
  useEffect(() => {
    callbacksRef.current = { onResult, onAdvance };
  });

  const position = Math.max(0, block.sentences.findIndex((sentence) => sentence.index === sentenceIndex));
  const sentence = block.sentences[position] ?? block.sentences[0];
  const text = sentence ? sentenceText(block.text, sentence) : block.text;

  const upload = useCallback(
    (blob: Blob, filename: string) => {
      keepRecording(blob);
      setUploading(true);
      assess.mutate(
        { partId: block.partId, blockIndex: block.blockIndex, blob, filename, sentenceIndex },
        {
          onSuccess: (assessment) => {
            setUploading(false);
            setResult(assessment);
            setTries((previous) => previous + 1);
            callbacksRef.current.onResult(assessment);
            if (assessment.scores.overall >= DRILL_PASS_SCORE) {
              setPassed(true);
              advanceTimerRef.current = globalThis.setTimeout(() => {
                advanceTimerRef.current = null;
                callbacksRef.current.onAdvance();
              }, DRILL_ADVANCE_DELAY_MS);
            }
          },
          onError: (error) => {
            setUploading(false);
            setUploadError(describeAssessError(error, t));
          }
        }
      );
    },
    [assess, block.blockIndex, block.partId, keepRecording, sentenceIndex, t]
  );

  const recorder = useRecording({
    maxSeconds,
    onBeforeRecord: () => {
      setUploadError(null);
      onBeforeRecord();
    },
    onCaptured: (blob, filename) => upload(blob, filename),
    shortcut: !uploading && !passed,
    enabled: assessAvailable && supported
  });
  const { cancel: cancelRecording, setError: setRecorderError } = recorder;

  // A new sentence (or block) starts over.
  const sentenceKey = `${block.key}|${sentenceIndex}`;
  const sentenceKeyRef = useRef(sentenceKey);
  useEffect(() => {
    if (sentenceKeyRef.current === sentenceKey) {
      return;
    }
    sentenceKeyRef.current = sentenceKey;
    if (advanceTimerRef.current) {
      globalThis.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    cancelRecording();
    setRecorderError(null);
    setResult(null);
    setTries(0);
    setPassed(false);
    setUploading(false);
    setUploadError(null);
    callbacksRef.current.onResult(null);
  }, [cancelRecording, sentenceKey, setRecorderError]);

  useEffect(
    () => () => {
      if (advanceTimerRef.current) {
        globalThis.clearTimeout(advanceTimerRef.current);
      }
    },
    []
  );

  if (!assessAvailable || !supported) {
    return (
      <Panel tone="muted" title={t("reading.drill.title")}>
        <Alert tone="warning" message={!assessAvailable ? t("reading.shadow.unavailable") : t("reading.shadow.unsupported")} />
      </Panel>
    );
  }

  const recorderError = recorder.error ? describeRecordingError(recorder.error, t) : null;
  const error = uploadError ? { title: undefined, message: uploadError } : recorderError;
  const offerNext = !passed && tries >= DRILL_MAX_TRIES;
  const charOffset = result?.char_offset ?? sentence?.char_start ?? 0;

  return (
    <Panel
      aria-label={t("reading.drill.title")}
      title={t("reading.drill.title")}
      description={t("reading.drill.sentence", { index: position + 1, total: block.sentences.length })}
      aria-live="polite"
    >
      <blockquote className="border-l-2 border-primary/50 pl-3 font-serif text-[1.0625rem] leading-relaxed text-fg">{text}</blockquote>
      {error ? <Alert tone="danger" role="alert" title={error.title} message={error.message} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        {recorder.recording ? (
          <Button variant="danger" onClick={recorder.stop}>
            <StopIcon />
            {t("reading.shadow.stop")}
          </Button>
        ) : (
          <Button onClick={() => void recorder.start()} busy={uploading} busyLabel={t("reading.shadow.assessing")} disabled={passed}>
            {recorder.error === "permission_denied" ? <MicOffIcon /> : <MicIcon />}
            {t("reading.drill.record")}
          </Button>
        )}
        <Button variant="secondary" onClick={onListenSentence} busy={modelBusy} disabled={recorder.recording}>
          <WaveIcon />
          {t("reading.drill.listenSentence")}
        </Button>
        {recorder.recording ? (
          <span role="timer" aria-live="off" className="nums inline-flex items-center gap-2 text-sm text-fg">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-danger motion-safe:animate-pulse" />
            {t("reading.shadow.recording", { seconds: Math.floor(recorder.elapsed) })}
          </span>
        ) : null}
        {tries > 0 ? <span className="nums text-xs text-fg-muted">{t("reading.drill.tries", { count: tries, max: DRILL_MAX_TRIES })}</span> : null}
      </div>

      {passed ? (
        <p role="status" className="inline-flex items-center gap-2 text-sm font-medium text-success">
          <CircleCheckIcon />
          {t("reading.drill.passed")}
        </p>
      ) : null}

      {offerNext ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-fg-muted">{t("reading.drill.offerNextHint")}</p>
          <Button variant="secondary" size="sm" onClick={onAdvance}>
            {t("reading.drill.offerNext")}
            <ArrowRightIcon />
          </Button>
        </div>
      ) : null}

      {result ? (
        <AssessmentResult
          assessment={result}
          compact
          onPlayWord={(word) => {
            const [shifted] = shiftWords([word], charOffset);
            onPlayWord(shifted);
          }}
          onPlayMine={mine.playWord}
          phonemesOffReason={phonemesOffReason}
          modelBusy={modelBusy}
        />
      ) : (
        <p className="text-xs text-fg-subtle">{t("reading.drill.hint")}</p>
      )}
    </Panel>
  );
}
