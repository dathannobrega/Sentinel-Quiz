"use client";

import { useId } from "react";

import { Kbd } from "@/components/ui/kbd";
import { selectSmClassName } from "@/components/ui/input";
import {
  ClockIcon,
  GaugeIcon,
  HeadphonesIcon,
  ListIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpinnerIcon,
  VolumeIcon
} from "@/components/ui/icons";
import { formatSpeed } from "@/features/reading/lib/format";
import type { ReaderMode } from "@/features/reading/lib/prefs";
import { formatCountdown, SLEEP_TIMER_OPTIONS, type SleepTimerOption } from "@/features/reading/lib/sleep-timer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { ReadingVoice } from "@/types/api";

export type ReaderEngine = "tts" | "browser";

export interface PlayerBarProps {
  isPlaying: boolean;
  isLoading: boolean;
  /** False when neither the neural TTS nor the browser voice can play. */
  canPlay: boolean;
  blockLabel: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  speed: number;
  speeds: number[];
  onSpeedChange: (speed: number) => void;
  engine: ReaderEngine;
  voice: string | null;
  voices: ReadingVoice[];
  onVoiceChange: (voice: string) => void;
  autoAdvance: boolean;
  onAutoAdvanceChange: (value: boolean) => void;
  follow: boolean;
  onFollowChange: (value: boolean) => void;
  mode: ReaderMode;
  onModeChange: (mode: ReaderMode) => void;
  shadowEnabled: boolean;
  /** Sentence drill (needs the assessment too); hidden when undefined. */
  drillEnabled?: boolean;
  /** Listen and repeat (needs the assessment too); hidden when undefined. */
  repeatEnabled?: boolean;
  /** Why the practice modes are disabled (default: the assessment is unavailable). */
  modesDisabledReason?: string;
  /** Streamed audio: the next sentence has not arrived yet. */
  buffering?: boolean;
  /** "Tap to translate" switch; hidden when the glossary is not available (offline). */
  glossaryAvailable?: boolean;
  glossaryTap?: boolean;
  onGlossaryTapChange?: (value: boolean) => void;
  sleepOption?: SleepTimerOption;
  onSleepOptionChange?: (option: SleepTimerOption) => void;
  /** Seconds left on a timed sleep option (null otherwise). */
  sleepRemainingSeconds?: number | null;
}

function ToggleChip({ pressed, onChange, label }: { pressed: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        "focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
        pressed ? "border-primary/40 bg-primary-soft text-primary" : "border-line text-fg-muted hover:text-fg"
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", pressed ? "bg-primary" : "bg-fg-subtle")} />
      {label}
    </button>
  );
}

/**
 * Sticky bottom controls: previous / play-pause / next, speed, voice, auto-advance, follow and the
 * Listen / Shadowing mode switch. Sits above the mobile tab bar (4rem + safe area) below `lg`.
 */
export function PlayerBar(props: PlayerBarProps) {
  const { t } = useI18n();
  const speedId = useId();
  const voiceId = useId();
  const sleepId = useId();
  const iconButton =
    "focus-ring inline-grid size-10 place-items-center rounded-md text-fg transition-colors hover:bg-surface-muted disabled:text-fg-subtle disabled:hover:bg-transparent";

  const modes: Array<{ value: ReaderMode; label: string; icon: typeof HeadphonesIcon; disabled?: boolean }> = [
    { value: "listen", label: t("reading.player.modeListen"), icon: HeadphonesIcon },
    // The recommended practice (model → your turn → review at your pace) comes first.
    ...(props.repeatEnabled === undefined
      ? []
      : [{ value: "repeat" as const, label: t("reading.player.modeRepeat"), icon: RepeatIcon, disabled: !props.repeatEnabled }]),
    ...(props.drillEnabled === undefined
      ? []
      : [{ value: "drill" as const, label: t("reading.player.modeDrill"), icon: ListIcon, disabled: !props.drillEnabled }]),
    { value: "shadow", label: t("reading.player.modeShadow"), icon: MicIcon, disabled: !props.shadowEnabled }
  ];
  const disabledReason = props.modesDisabledReason ?? t("reading.capabilities.assessUnavailableTitle");
  const sleepLabel = (option: SleepTimerOption) =>
    option === "off" ? t("reading.player.sleepOff") : option === "section" ? t("reading.player.sleepSection") : t("reading.player.sleepMinutes", { minutes: option });

  return (
    <div
      role="region"
      aria-label={t("reading.player.label")}
      className="sticky z-20 border-t border-line bg-canvas/95 px-4 pt-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm max-lg:bottom-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 lg:bottom-0 lg:px-10"
    >
      <div className="mx-auto flex max-w-reading flex-col gap-2 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button type="button" className={iconButton} aria-label={t("reading.player.previousBlock")} title={t("reading.player.previousBlock")} onClick={props.onPrevious} disabled={!props.hasPrevious}>
              <SkipBackIcon size={18} />
            </button>
            <button
              type="button"
              className="focus-ring inline-grid size-12 place-items-center rounded-full bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:bg-surface-muted disabled:text-fg-subtle"
              aria-label={props.isPlaying ? t("reading.player.pause") : t("reading.player.play")}
              title={props.isPlaying ? t("reading.player.pause") : t("reading.player.play")}
              aria-busy={props.isLoading || undefined}
              onClick={props.onToggle}
              disabled={!props.canPlay}
            >
              {props.isLoading ? <SpinnerIcon size={20} /> : props.isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
            </button>
            <button type="button" className={iconButton} aria-label={t("reading.player.nextBlock")} title={t("reading.player.nextBlock")} onClick={props.onNext} disabled={!props.hasNext}>
              <SkipForwardIcon size={18} />
            </button>
            <span className="nums ml-2 hidden text-xs text-fg-muted sm:inline" aria-live="polite">
              {props.blockLabel}
            </span>
            {props.buffering ? (
              <span role="status" className="ml-2 inline-flex items-center gap-1.5 text-xs text-fg-muted">
                <SpinnerIcon size={12} />
                {t("reading.reader.buffering")}
              </span>
            ) : null}
          </div>

          <div role="group" aria-label={t("reading.player.mode")} className="inline-flex rounded-md bg-surface-muted p-0.5">
            {modes.map(({ value, label, icon: ModeIcon, disabled }) => {
              const active = props.mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => props.onModeChange(value)}
                  title={disabled ? disabledReason : label}
                  className={cn(
                    "focus-ring inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:text-fg-subtle",
                    active ? "bg-surface text-fg shadow-raised" : "text-fg-muted hover:text-fg"
                  )}
                >
                  <ModeIcon size={14} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted" htmlFor={speedId}>
            <GaugeIcon size={14} />
            <span className="sr-only">{t("reading.player.speed")}</span>
            <select
              id={speedId}
              className={cn(selectSmClassName, "h-8 w-auto min-w-20 py-0 pr-7 text-xs")}
              value={String(props.speed)}
              onChange={(event) => props.onSpeedChange(Number(event.target.value))}
            >
              {props.speeds.map((speed) => (
                <option key={speed} value={String(speed)}>
                  {t("reading.player.speedValue", { speed: formatSpeed(speed) })}
                </option>
              ))}
            </select>
          </label>

          {props.engine === "tts" && props.voices.length > 0 ? (
            <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted" htmlFor={voiceId}>
              <VolumeIcon size={14} />
              <span className="sr-only">{t("reading.player.voice")}</span>
              <select
                id={voiceId}
                className={cn(selectSmClassName, "h-8 w-auto min-w-28 py-0 pr-7 text-xs")}
                value={props.voice ?? props.voices[0]?.id ?? ""}
                onChange={(event) => props.onVoiceChange(event.target.value)}
              >
                {props.voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 text-xs text-fg-muted">
              <VolumeIcon size={14} />
              {t("reading.player.browserVoice")}
            </span>
          )}

          <ToggleChip pressed={props.autoAdvance} onChange={props.onAutoAdvanceChange} label={t("reading.player.autoAdvance")} />
          <ToggleChip pressed={props.follow} onChange={props.onFollowChange} label={t("reading.player.follow")} />
          {props.glossaryAvailable && props.onGlossaryTapChange ? (
            <ToggleChip pressed={Boolean(props.glossaryTap)} onChange={props.onGlossaryTapChange} label={t("reading.player.glossaryTap")} />
          ) : null}

          {props.onSleepOptionChange ? (
            <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted" htmlFor={sleepId}>
              <ClockIcon size={14} />
              <span className="sr-only">{t("reading.player.sleep")}</span>
              <select
                id={sleepId}
                className={cn(selectSmClassName, "h-8 w-auto min-w-28 py-0 pr-7 text-xs")}
                value={props.sleepOption ?? "off"}
                onChange={(event) => props.onSleepOptionChange?.(event.target.value as SleepTimerOption)}
              >
                {SLEEP_TIMER_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {sleepLabel(option)}
                  </option>
                ))}
              </select>
              {props.sleepRemainingSeconds !== null && props.sleepRemainingSeconds !== undefined ? (
                <span className="nums" role="timer" aria-live="off" aria-label={t("reading.player.sleepRemaining", { time: formatCountdown(props.sleepRemainingSeconds * 1000) })}>
                  {formatCountdown(props.sleepRemainingSeconds * 1000)}
                </span>
              ) : props.sleepOption === "section" ? (
                <span>{t("reading.player.sleepAtSectionEnd")}</span>
              ) : null}
            </label>
          ) : null}

          <span className="ml-auto hidden items-center gap-1 text-[0.6875rem] text-fg-subtle lg:inline-flex">
            <Kbd>␣</Kbd>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
            <Kbd>R</Kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
