"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MicIcon, MicOffIcon, StopIcon, WaveIcon } from "@/components/ui/icons";
import { Panel } from "@/components/ui/section";
import { AssessmentResult } from "@/features/reading/components/assessment-result";
import { useAssessMutation, useReadingAttemptsQuery } from "@/features/reading/hooks";
import type { ReaderBlock } from "@/features/reading/lib/blocks";
import { isRecordingSupported, MAX_RECORDING_SECONDS } from "@/features/reading/lib/recorder";
import { usePhonemesOffReason, useMyRecording } from "@/features/reading/lib/use-my-recording";
import { describeRecordingError, useRecording } from "@/features/reading/lib/use-recording";
import { ApiError, readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import type { ReadingAssessedWord, ReadingAssessment } from "@/types/api";

export interface ShadowPanelProps {
  sectionId: string;
  block: ReaderBlock;
  assessAvailable: boolean;
  maxSeconds?: number;
  /** Plays the model (TTS) audio of the block. */
  onListenModel: () => void;
  onPlayWord: (word: ReadingAssessedWord) => void;
  modelBusy: boolean;
  /** Called before recording starts (pause any model playback). */
  onBeforeRecord: () => void;
}

type Phase = "idle" | "uploading" | "result";

const ERROR_STATUS_CODES: Record<number, string> = {
  413: "audio_too_large",
  415: "audio_unsupported",
  429: "reading_quota_exceeded",
  503: "speech_unavailable",
  504: "speech_timeout"
};

/** Message for an assess failure: by API error `code`, then by status, then the API text. */
export function describeAssessError(error: unknown, t: (key: string, values?: Record<string, string | number>) => string): string {
  if (error instanceof ApiError) {
    const code = error.code && !error.code.startsWith("http_") ? error.code : ERROR_STATUS_CODES[error.status];
    if (code) {
      const key = `reading.shadow.errors.${code}`;
      const text = t(key);
      if (text !== key) {
        return text;
      }
    }
  }
  return readErrorMessage(error, t("reading.shadow.errors.generic"));
}

/** Record the block, upload it, show the assessment. Owns the `R` shortcut while mounted. */
export function ShadowPanel({ sectionId, block, assessAvailable, maxSeconds = MAX_RECORDING_SECONDS, onListenModel, onPlayWord, modelBusy, onBeforeRecord }: ShadowPanelProps) {
  const { t } = useI18n();
  const assess = useAssessMutation(sectionId);
  const attemptsQuery = useReadingAttemptsQuery(sectionId, assessAvailable);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ReadingAssessment | null>(null);
  const mine = useMyRecording();
  const { setRecording: keepRecording } = mine;
  const phonemesOffReason = usePhonemesOffReason();
  const [previousBest, setPreviousBest] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const supported = typeof window !== "undefined" ? isRecordingSupported() : true;

  const blockAttempts = useMemo(
    () =>
      (attemptsQuery.data?.attempts ?? []).filter(
        (attempt) => attempt.part_id === block.partId && attempt.block_index === block.blockIndex && (attempt.sentence_index ?? null) === null
      ),
    [attemptsQuery.data, block.partId, block.blockIndex]
  );

  const upload = useCallback(
    (blob: Blob, filename: string) => {
      keepRecording(blob);
      setPhase("uploading");
      const best = blockAttempts.reduce<number | null>((acc, attempt) => (acc === null || attempt.overall > acc ? attempt.overall : acc), null);
      setPreviousBest(best);
      assess.mutate(
        { partId: block.partId, blockIndex: block.blockIndex, blob, filename },
        {
          onSuccess: (assessment) => {
            setResult(assessment);
            setPhase("result");
          },
          onError: (mutationError) => {
            setUploadError(describeAssessError(mutationError, t));
            setPhase("idle");
          }
        }
      );
    },
    [assess, block.blockIndex, block.partId, blockAttempts, keepRecording, t]
  );

  const recorder = useRecording({
    maxSeconds,
    onBeforeRecord: () => {
      setUploadError(null);
      setResult(null);
      setPhase("idle");
      onBeforeRecord();
    },
    onCaptured: (blob, filename) => upload(blob, filename),
    shortcut: phase !== "uploading",
    enabled: assessAvailable && supported
  });
  const { cancel: cancelRecording, setError: setRecorderError } = recorder;

  // A new block means a fresh attempt.
  const blockKeyRef = useRef(block.key);
  useEffect(() => {
    if (blockKeyRef.current !== block.key) {
      blockKeyRef.current = block.key;
      cancelRecording();
      setRecorderError(null);
      setPhase("idle");
      setResult(null);
      setUploadError(null);
      setPreviousBest(null);
    }
  }, [block.key, cancelRecording, setRecorderError]);

  if (!assessAvailable) {
    return (
      <Panel tone="muted" title={t("reading.shadow.title")}>
        <Alert tone="warning" message={t("reading.shadow.unavailable")} />
      </Panel>
    );
  }

  if (!supported) {
    return (
      <Panel tone="muted" title={t("reading.shadow.title")}>
        <Alert tone="warning" title={t("reading.shadow.unsupportedTitle")} message={t("reading.shadow.unsupported")} />
      </Panel>
    );
  }

  const recorderError = recorder.error ? describeRecordingError(recorder.error, t) : null;
  const error = uploadError ? { title: undefined, message: uploadError } : recorderError;
  const remaining = Math.max(0, Math.ceil(maxSeconds - recorder.elapsed));
  const isNewBest = result !== null && (previousBest === null ? result.attempts_for_block <= 1 && blockAttempts.length === 0 : result.scores.overall > previousBest);

  return (
    <Panel title={t("reading.shadow.title")} description={phase === "result" ? undefined : t("reading.shadow.intro")} aria-live="polite">
      {error ? <Alert tone="danger" role="alert" title={error.title} message={error.message} /> : null}

      {phase === "result" && result ? (
        <AssessmentResult
          assessment={result}
          attempts={blockAttempts}
          isNewBest={isNewBest}
          onListenModel={onListenModel}
          onPlayWord={onPlayWord}
          onPlayMine={mine.playWord}
          phonemesOffReason={phonemesOffReason}
          modelBusy={modelBusy}
          onTryAgain={() => {
            setResult(null);
            setPhase("idle");
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {recorder.recording ? (
              <Button variant="danger" onClick={recorder.stop} aria-label={t("reading.shadow.stop")}>
                <StopIcon />
                {t("reading.shadow.stop")}
              </Button>
            ) : (
              <Button onClick={() => void recorder.start()} busy={phase === "uploading"} busyLabel={t("reading.shadow.assessing")} aria-label={t("reading.shadow.record")}>
                {recorder.error === "permission_denied" ? <MicOffIcon /> : <MicIcon />}
                {t("reading.shadow.record")}
              </Button>
            )}
            <Button variant="secondary" onClick={onListenModel} busy={modelBusy} disabled={recorder.recording}>
              <WaveIcon />
              {t("reading.shadow.listenModel")}
            </Button>
            {recorder.recording ? (
              <span role="timer" aria-live="off" className="nums inline-flex items-center gap-2 text-sm text-fg">
                <span aria-hidden="true" className="size-2.5 rounded-full bg-danger motion-safe:animate-pulse" />
                {t("reading.shadow.recording", { seconds: Math.floor(recorder.elapsed) })}
                <span className="text-fg-muted">· {t("reading.shadow.remaining", { seconds: remaining })}</span>
              </span>
            ) : null}
            {phase === "uploading" ? (
              <span role="status" className="text-sm text-fg-muted">
                {recorder.hitLimit ? t("reading.shadow.maxReached", { seconds: maxSeconds }) : t("reading.shadow.assessing")}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-fg-subtle">{t("reading.shadow.recordHint")}</p>
          {blockAttempts.length ? (
            <p className="nums text-xs text-fg-muted">
              {t("reading.shadow.attemptsCount", {
                count: blockAttempts.length,
                best: Math.round(Math.max(...blockAttempts.map((attempt) => attempt.overall)) * 100)
              })}
            </p>
          ) : (
            <p className="text-xs text-fg-muted">{t("reading.shadow.attemptsEmpty")}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
