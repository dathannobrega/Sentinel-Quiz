"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PauseIcon, PlayIcon, RepeatIcon, SpinnerIcon, XIcon } from "@/components/ui/icons";
import { Panel } from "@/components/ui/section";
import { AssessmentResult } from "@/features/reading/components/assessment-result";
import { describeAssessError } from "@/features/reading/components/shadow-panel";
import { useAssessMutation } from "@/features/reading/hooks";
import type { ReaderBlock } from "@/features/reading/lib/blocks";
import { scoreToPercent } from "@/features/reading/lib/format";
import { isTypingTarget } from "@/features/reading/lib/keyboard";
import { ListenRepeatMachine, REPEAT_MAX_TRIES, type RepeatEffect, type RepeatState } from "@/features/reading/lib/listen-repeat";
import { isRecordingSupported } from "@/features/reading/lib/recorder";
import { sentenceText, shiftWords } from "@/features/reading/lib/sentences";
import { isSilenceDetectionSupported, repeatRecordingCapSeconds } from "@/features/reading/lib/silence-detector";
import { describeRecordingError, useRecording } from "@/features/reading/lib/use-recording";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { ReadingAssessedWord, ReadingAssessment } from "@/types/api";

export interface ListenRepeatPanelProps {
  sectionId: string;
  block: ReaderBlock;
  /** False on the last block of the section (the drill stops instead of continuing). */
  hasNextBlock: boolean;
  assessAvailable: boolean;
  /** Plays the model audio of the sentence at `position` (0-based); resolves when it ends. */
  playSentence: (position: number) => Promise<void>;
  /** Stops the model playback. */
  stopModel: () => void;
  /** Duration of the model audio of a sentence when known (sets the recording cap). */
  sentenceDuration: (position: number) => number | null;
  /** Plays the model audio of one word (offsets relative to the block). */
  onPlayWord: (word: ReadingAssessedWord) => void;
  modelBusy: boolean;
  /** Current sentence (by `ReadingSentence.index`) and last assessment, to mark the words in the block. */
  onSentenceChange: (sentenceIndex: number, assessment: ReadingAssessment | null) => void;
  /** Every sentence of the block passed (or was given up): continue with the next block. */
  onBlockDone: () => void;
  /** Leave the mode (Esc / Exit). */
  onExit: () => void;
  /** Start by itself when the block mounts (hands-free continuation into the next block). */
  autoStart?: boolean;
}

/**
 * Hands-free sentence loop: the model sentence plays, a short cue, the microphone opens and
 * stops on silence, the assessment shows for 3 s, then the next sentence (or the same one again,
 * up to 3 times). Space pauses/resumes, Esc exits; every phase is announced through `role=status`.
 */
export function ListenRepeatPanel({
  sectionId,
  block,
  hasNextBlock,
  assessAvailable,
  playSentence,
  stopModel,
  sentenceDuration,
  onPlayWord,
  modelBusy,
  onSentenceChange,
  onBlockDone,
  onExit,
  autoStart = false
}: ListenRepeatPanelProps) {
  const { t } = useI18n();
  const assess = useAssessMutation(sectionId);
  const supported = typeof window !== "undefined" ? isRecordingSupported() : true;
  const silenceSupported = typeof window !== "undefined" ? isSilenceDetectionSupported() : true;
  const [state, setState] = useState<RepeatState>({
    phase: "idle",
    sentence: 0,
    tries: 0,
    lastScore: null,
    passed: false
  });
  const [result, setResult] = useState<ReadingAssessment | null>(null);
  const [error, setError] = useState<{
    title?: string;
    message: string;
  } | null>(null);
  const machineRef = useRef<ListenRepeatMachine | null>(null);
  const callbacksRef = useRef({
    playSentence,
    stopModel,
    sentenceDuration,
    onSentenceChange,
    onBlockDone,
    onExit,
    hasNextBlock,
    assess,
    t
  });
  useEffect(() => {
    callbacksRef.current = {
      playSentence,
      stopModel,
      sentenceDuration,
      onSentenceChange,
      onBlockDone,
      onExit,
      hasNextBlock,
      assess,
      t
    };
  });

  const sentences = block.sentences;
  const sentence = sentences[state.sentence] ?? sentences[0];
  const text = sentence ? sentenceText(block.text, sentence) : block.text;
  const enabled = assessAvailable && supported;

  const recorder = useRecording({
    stopOnSilence: true,
    onCaptured: (blob, filename) => machineRef.current?.recordingCaptured(blob, filename),
    enabled
  });
  const recorderRef = useRef(recorder);
  useEffect(() => {
    recorderRef.current = recorder;
  }, [recorder]);

  const runEffect = useCallback(
    (effect: RepeatEffect) => {
      const callbacks = callbacksRef.current;
      switch (effect.type) {
        case "play_model":
          setError(null);
          setResult(null);
          callbacks.onSentenceChange(sentences[effect.sentence]?.index ?? 0, null);
          callbacks.playSentence(effect.sentence).then(
            () => machineRef.current?.modelEnded(),
            () => {
              setError({ message: callbacks.t("reading.reader.audioFailed") });
              machineRef.current?.fail();
            }
          );
          break;
        case "start_recording": {
          const cap = repeatRecordingCapSeconds(callbacks.sentenceDuration(effect.sentence));
          void recorderRef.current.start({ maxSeconds: cap });
          break;
        }
        case "assess": {
          const target = sentences[effect.sentence];
          callbacks.assess.mutate(
            {
              partId: block.partId,
              blockIndex: block.blockIndex,
              blob: effect.blob,
              filename: effect.filename,
              sentenceIndex: target?.index ?? 0
            },
            {
              onSuccess: (assessment) => {
                setResult(assessment);
                callbacks.onSentenceChange(target?.index ?? 0, assessment);
                machineRef.current?.assessed(assessment.scores.overall);
              },
              onError: (reason) => {
                setError({ message: describeAssessError(reason, callbacks.t) });
                machineRef.current?.fail();
              }
            }
          );
          break;
        }
        case "stop":
          callbacks.stopModel();
          recorderRef.current.cancel();
          break;
        case "finished":
          if (callbacks.hasNextBlock) {
            callbacks.onBlockDone();
          }
          break;
      }
    },
    [block.blockIndex, block.partId, sentences]
  );

  // One machine per block: a new block starts over (hands-free when the previous one finished).
  const autoStartRef = useRef(autoStart);
  useEffect(() => {
    const machine = new ListenRepeatMachine({
      sentenceCount: sentences.length,
      onEffect: runEffect,
      onChange: setState
    });
    machineRef.current = machine;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the machine owns the phase; reset on block change
    setState(machine.state);
    setResult(null);
    setError(null);
    if (autoStartRef.current && enabled) {
      machine.start(0);
    }
    return () => {
      machine.exit();
      machine.dispose();
      machineRef.current = null;
    };
  }, [block.key, enabled, runEffect, sentences.length]);

  // A recorder failure (permission, too short...) pauses the loop with the message.
  const recorderError = recorder.error;
  useEffect(() => {
    if (recorderError && machineRef.current && machineRef.current.state.phase === "recording") {
      setError(describeRecordingError(recorderError, t));
      machineRef.current.fail();
    }
  }, [recorderError, t]);

  // Space pauses/resumes, Esc exits.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key === "Escape") {
        // Works with a panel button focused too; only text fields own Escape.
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
          return;
        }
        event.preventDefault();
        callbacksRef.current.onExit();
      } else if ((event.key === " " || event.code === "Space") && !isTypingTarget(event.target)) {
        event.preventDefault();
        machineRef.current?.toggle();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const phaseText = useMemo(() => {
    switch (state.phase) {
      case "model":
        return t("reading.repeat.phaseModel");
      case "cue":
        return t("reading.repeat.phaseCue");
      case "recording":
        return t("reading.repeat.phaseRecording", {
          seconds: Math.floor(recorder.elapsed)
        });
      case "assessing":
        return t("reading.repeat.phaseAssessing");
      case "result":
        return state.passed
          ? `${t("reading.repeat.phaseResult", { percent: scoreToPercent(state.lastScore) })} · ${t("reading.repeat.passed")}`
          : `${t("reading.repeat.phaseResult", { percent: scoreToPercent(state.lastScore) })} · ${
              state.tries >= REPEAT_MAX_TRIES
                ? t("reading.repeat.movingOn")
                : t("reading.repeat.retry", {
                    count: state.tries + 1,
                    max: REPEAT_MAX_TRIES
                  })
            }`;
      case "paused":
        return t("reading.repeat.phasePaused");
      case "done":
        return hasNextBlock ? t("reading.repeat.phaseDone") : t("reading.repeat.phaseDoneLast");
      default:
        return t("reading.repeat.intro");
    }
  }, [hasNextBlock, recorder.elapsed, state, t]);

  if (!assessAvailable || !supported) {
    return (
      <Panel tone="muted" title={t("reading.repeat.title")}>
        <Alert tone="warning" message={!assessAvailable ? t("reading.shadow.unavailable") : t("reading.shadow.unsupported")} />
      </Panel>
    );
  }

  const running = state.phase !== "idle" && state.phase !== "paused" && state.phase !== "done";
  const charOffset = result?.char_offset ?? sentence?.char_start ?? 0;

  return (
    <Panel
      aria-label={t("reading.repeat.title")}
      title={t("reading.repeat.title")}
      description={t("reading.repeat.sentence", {
        index: state.sentence + 1,
        total: sentences.length
      })}
    >
      <blockquote
        className={cn(
          "border-l-2 pl-3 font-serif text-[1.0625rem] leading-relaxed text-fg transition-colors",
          state.phase === "cue" || state.phase === "recording" ? "border-danger" : "border-primary/50"
        )}
      >
        {text}
      </blockquote>
      {error ? <Alert tone="danger" role="alert" title={error.title} message={error.message} /> : null}

      <p role="status" aria-live="polite" className="inline-flex min-h-6 items-center gap-2 text-sm text-fg">
        {state.phase === "recording" ? <span aria-hidden="true" className="size-2.5 rounded-full bg-danger motion-safe:animate-pulse" /> : null}
        {state.phase === "assessing" || state.phase === "model" ? <SpinnerIcon size={14} className="text-fg-muted" /> : null}
        {phaseText}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {state.phase === "idle" || state.phase === "done" ? (
          <Button onClick={() => machineRef.current?.start(0)}>
            <RepeatIcon />
            {state.phase === "done" ? t("reading.repeat.restart") : t("reading.repeat.start")}
          </Button>
        ) : state.phase === "paused" ? (
          <Button onClick={() => machineRef.current?.resume()}>
            <PlayIcon />
            {t("reading.repeat.resume")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => machineRef.current?.pause()} disabled={!running}>
            <PauseIcon />
            {t("reading.repeat.pause")}
          </Button>
        )}
        <Button variant="ghost" onClick={onExit}>
          <XIcon />
          {t("reading.repeat.exit")}
        </Button>
        {state.tries > 0 ? (
          <span className="nums text-xs text-fg-muted">
            {t("reading.repeat.tries", {
              count: state.tries,
              max: REPEAT_MAX_TRIES
            })}
          </span>
        ) : null}
      </div>

      {result ? (
        <AssessmentResult
          assessment={result}
          compact
          onPlayWord={(word) => {
            const [shifted] = shiftWords([word], charOffset);
            onPlayWord(shifted);
          }}
          modelBusy={modelBusy}
        />
      ) : (
        <p className="text-xs text-fg-subtle">
          {t("reading.repeat.shortcuts")}
          {!silenceSupported ? ` ${t("reading.repeat.silenceUnsupported")}` : null}
        </p>
      )}
    </Panel>
  );
}
