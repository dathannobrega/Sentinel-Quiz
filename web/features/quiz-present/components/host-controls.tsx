"use client";

import { useId, useState } from "react";

import { Avatar } from "@/components/quiz-kit/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { PauseGlyph, TransportBadge } from "@/features/quiz-live/components/live-chrome";
import type { LiveConnectionState } from "@/features/quiz-live/lib/live-store";
import { normalizeTimeMultiplier, TIME_MULTIPLIERS, type HostParticipant, type TimeMultiplier } from "@/features/quiz-live/lib/protocol";
import {
  availableActions,
  contextualAction,
  EXTEND_STEPS_S,
  timeControls,
  type HostAction,
  type HostContext
} from "@/features/quiz-present/lib/host-actions";
import { CapacityWarning, PreflightChip } from "@/features/quiz-present/components/room-ops";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

const ACTION_LABEL: Record<HostAction, string> = {
  start: "quizPresent.controls.start",
  lock: "quizPresent.controls.lock",
  reveal: "quizPresent.controls.reveal",
  next: "quizPresent.controls.next",
  leaderboard: "quizPresent.controls.leaderboard",
  podium: "quizPresent.controls.podium",
  end: "quizPresent.controls.end"
};

const barButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-[calc(var(--lq-radius)*0.6)] px-3 text-sm font-semibold transition-[background-color,transform] duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100";
const barSecondary = cn(barButton, "border border-lq-line bg-lq-surface text-lq-fg hover:bg-lq-surface-2");

function StatusDot({ connection }: { connection: LiveConnectionState }) {
  const { t } = useI18n();
  const tone = connection.status === "open" ? "bg-lq-success" : connection.status === "closed" || connection.status === "idle" ? "bg-lq-danger" : "bg-lq-warning";
  return (
    <span className="flex items-center gap-2 text-xs font-semibold text-lq-fg-muted" role="status">
      <span aria-hidden="true" className={cn("size-2.5 rounded-full", tone, connection.status === "reconnecting" && "animate-pulse")} />
      {t(`quizPresent.controls.status.${connection.status}`)}
    </span>
  );
}

/** Play triangle for "Retomar". */
function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M7 4.8v14.4a1 1 0 0 0 1.52.85l11.3-7.2a1 1 0 0 0 0-1.7L8.52 3.95A1 1 0 0 0 7 4.8Z" fill="currentColor" />
    </svg>
  );
}

/** "Ensaio" pill (rehearsal sessions, RF-513). */
export function RehearsalBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      title={t("quizPresent.controls.rehearsalHint")}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-dashed border-lq-warning px-2.5 py-0.5 text-[0.7rem] font-bold tracking-wide text-lq-warning uppercase",
        className
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {t("quizPresent.controls.rehearsal")}
      <span className="sr-only">: {t("quizPresent.controls.rehearsalHint")}</span>
    </span>
  );
}

export interface HostControlBarProps {
  context: HostContext;
  /** Rehearsal session (RF-513): shows the "Ensaio" badge. */
  rehearsal?: boolean;
  onTogglePause: () => void;
  onExtend: (seconds: number) => void;
  connection: LiveConnectionState;
  participantCount: number;
  roomLocked: boolean;
  calm: boolean;
  isFullscreen: boolean;
  fullscreenSupported: boolean;
  openingDisplay: boolean;
  mode: "host" | "presenter";
  onAction: (action: HostAction) => void;
  onToggleRoomLock: () => void;
  onToggleCalm: () => void;
  onToggleFullscreen: () => void;
  onOpenDisplay: () => void;
  onSwitchView: () => void;
  onOpenParticipants: () => void;
  onOpenHelp: () => void;
  onHide?: () => void;
  /** Room limit from the snapshot: warning pill at 80% (RF-1205). */
  maxParticipants?: number | null;
  /** Pre-event check (RF-1115): offered in the lobby. */
  preflight?: { overall: "ready" | "attention" | null; running: boolean; onOpen: () => void };
  /** Phone preview (RF-514): rehearsal sessions only. */
  preview?: { active: boolean; busy: boolean; onToggle: () => void };
  /** Word cloud moderation (Incremento 5): offered while a word cloud is on screen. */
  words?: { count: number; onOpen: () => void };
  /** Waiting room (Incremento 7): people waiting for approval or a seat. */
  waiting?: { count: number; onOpen: () => void };
}

/**
 * Presenter control bar: one big contextual action (Space/→), the explicit phase actions, room
 * controls and window tools. Everything is disabled while the socket is not open.
 */
export function HostControlBar(props: HostControlBarProps) {
  const { t } = useI18n();
  const { context, connection } = props;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const online = connection.status === "open";
  const primary = contextualAction(context);
  const available = availableActions(context);
  const time = timeControls(context);
  const showTime = time.pause || time.resume;

  const run = (action: HostAction) => {
    if (action === "end") {
      setConfirmEnd(true);
      return;
    }
    props.onAction(action);
  };

  return (
    <nav aria-label={t("quizPresent.controls.label")} className="flex flex-wrap items-center gap-2 border-t border-lq-line bg-lq-bg/95 px-3 py-2 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-3 pr-2">
        <StatusDot connection={connection} />
        <TransportBadge
          transport={connection.transport}
          label={t("quizPresent.controls.transportSse")}
          hint={t("quizPresent.controls.transportSseHint")}
        />
        {props.rehearsal ? <RehearsalBadge /> : null}
        <CapacityWarning count={props.participantCount} max={props.maxParticipants ?? null} />
        {context.qi !== null && context.total ? (
          <span className="hidden font-lq-mono text-xs text-lq-fg-muted sm:inline">{t("quizPresent.controls.progress", { current: context.qi + 1, total: context.total })}</span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
        {primary ? (
          <button
            type="button"
            onClick={() => run(primary)}
            disabled={!online}
            aria-keyshortcuts="Space ArrowRight"
            className={cn(barButton, "min-w-36 bg-lq-accent px-5 text-base font-bold text-lq-on-accent hover:brightness-110")}
          >
            {t(ACTION_LABEL[primary])}
            <span aria-hidden="true" className="font-lq-mono text-xs opacity-80">
              ␣
            </span>
          </button>
        ) : null}
        {(["lock", "reveal", "leaderboard"] as const)
          .filter((action) => action !== primary)
          .map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => run(action)}
              disabled={!online || !available[action]}
              aria-keyshortcuts={action === "lock" ? "L" : action === "reveal" ? "R" : "B"}
              className={barSecondary}
            >
              {t(ACTION_LABEL[action])}
            </button>
          ))}
        {showTime ? (
          <div role="group" aria-label={t("quizPresent.hotkeys.pause")} className="flex items-center gap-1 rounded-[calc(var(--lq-radius)*0.6)] border border-lq-line bg-lq-surface p-0.5">
            <button
              type="button"
              onClick={props.onTogglePause}
              disabled={!online}
              aria-keyshortcuts="P"
              className={cn(
                barButton,
                "min-h-10 gap-1.5",
                time.resume ? "bg-lq-warning text-lq-on-warning hover:brightness-110" : "text-lq-fg hover:bg-lq-surface-2"
              )}
            >
              {time.resume ? <PlayGlyph className="size-4" /> : <PauseGlyph className="size-4" />}
              {time.resume ? t("quizPresent.controls.resume") : t("quizPresent.controls.pause")}
            </button>
            {EXTEND_STEPS_S.map((seconds, index) => (
              <button
                key={seconds}
                type="button"
                onClick={() => props.onExtend(seconds)}
                disabled={!online || !time.extend}
                aria-label={t("quizPresent.controls.extendLabel", { seconds })}
                aria-keyshortcuts={index === 0 ? "+" : undefined}
                className={cn(barButton, "min-h-10 px-2.5 font-lq-mono text-lq-fg tabular-nums hover:bg-lq-surface-2")}
              >
                {t("quizPresent.controls.extend", { seconds })}
              </button>
            ))}
          </div>
        ) : null}
        {primary !== "next" && available.next ? (
          <button type="button" onClick={() => run("next")} disabled={!online} className={barSecondary}>
            {t(ACTION_LABEL.next)}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {props.preflight && context.phase === "lobby" ? (
          <button type="button" onClick={props.preflight.onOpen} className={barSecondary} aria-busy={props.preflight.running || undefined}>
            {props.preflight.running ? t("quizPresent.preflight.running") : t("quizPresent.preflight.button")}
            <PreflightChip overall={props.preflight.running ? null : props.preflight.overall} />
          </button>
        ) : null}
        {props.preview ? (
          <button
            type="button"
            onClick={props.preview.onToggle}
            aria-pressed={props.preview.active}
            aria-busy={props.preview.busy || undefined}
            className={cn(barSecondary, props.preview.active && "border-lq-accent")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="4.5" y="1.5" width="7" height="13" rx="1.6" />
              <path d="M7 12.2h2" strokeLinecap="round" />
            </svg>
            {props.preview.active ? t("quizPresent.preview.hide") : t("quizPresent.preview.toggle")}
          </button>
        ) : null}
        {props.waiting ? (
          <button
            type="button"
            onClick={props.waiting.onOpen}
            className={barSecondary}
            aria-label={t("quizPresent.waiting.buttonLabel", { count: props.waiting.count })}
          >
            {t("quizPresent.waiting.button")}
            {props.waiting.count ? (
              <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-lq-accent px-1.5 text-xs font-bold text-lq-on-accent">
                {props.waiting.count}
              </span>
            ) : null}
          </button>
        ) : null}
        {props.words ? (
          <button type="button" onClick={props.words.onOpen} className={barSecondary}>
            {t("quizPresent.controls.words", { count: props.words.count })}
          </button>
        ) : null}
        <button type="button" onClick={props.onOpenParticipants} className={barSecondary}>
          {t("quizPresent.controls.participants", { count: props.participantCount })}
        </button>
        <button type="button" onClick={props.onToggleRoomLock} disabled={!online} aria-pressed={props.roomLocked} className={barSecondary}>
          {props.roomLocked ? t("quizPresent.controls.unlockRoom") : t("quizPresent.controls.lockRoom")}
        </button>
        <button type="button" onClick={props.onToggleCalm} aria-pressed={props.calm} aria-keyshortcuts="Z" className={barSecondary}>
          {t("quizPresent.controls.calm")}
        </button>
        {props.fullscreenSupported ? (
          <button type="button" onClick={props.onToggleFullscreen} aria-keyshortcuts="F" className={barSecondary}>
            {props.isFullscreen ? t("quizPresent.controls.exitFullscreen") : t("quizPresent.controls.fullscreen")}
          </button>
        ) : null}
        <button type="button" onClick={props.onOpenDisplay} disabled={props.openingDisplay} className={barSecondary}>
          {props.openingDisplay ? t("quizPresent.controls.openingDisplay") : t("quizPresent.controls.openDisplay")}
        </button>
        <button type="button" onClick={props.onSwitchView} className={barSecondary}>
          {props.mode === "host" ? t("quizPresent.controls.presenterView") : t("quizPresent.controls.stageView")}
        </button>
        <button type="button" onClick={props.onOpenHelp} aria-keyshortcuts="?" className={barSecondary} aria-label={t("quizPresent.controls.help")}>
          ?
        </button>
        <button
          type="button"
          onClick={() => run("end")}
          disabled={!online || !available.end}
          className={cn(barButton, "border border-lq-danger bg-lq-surface text-lq-danger hover:bg-lq-surface-2")}
        >
          {t("quizPresent.controls.end")}
        </button>
        {props.onHide ? (
          <button type="button" onClick={props.onHide} aria-keyshortcuts="H" className={barSecondary}>
            {t("quizPresent.controls.hide")}
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmEnd}
        title={t("quizPresent.controls.confirmEndTitle")}
        message={t("quizPresent.controls.confirmEndText")}
        confirmLabel={t("quizPresent.controls.confirmEnd")}
        cancelLabel={t("quizPresent.controls.cancel")}
        tone="danger"
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          props.onAction("end");
        }}
      />
    </nav>
  );
}

const TIME_KEY: Record<TimeMultiplier, string> = { 1: "m1", 1.5: "m15", 2: "m2", 0: "m0" };

/** Small badge for a non-default extended time (hidden for 1×). */
function TimeBadge({ multiplier }: { multiplier: TimeMultiplier }) {
  const { t, locale } = useI18n();
  if (multiplier === 1) {
    return null;
  }
  return (
    <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm bg-primary-soft px-1.5 text-[0.6875rem] font-semibold text-primary">
      {multiplier === 0
        ? t("quizPresent.participants.timeUntimedBadge")
        : t("quizPresent.participants.timeBadge", { multiplier: new Intl.NumberFormat(locale).format(multiplier) })}
    </span>
  );
}

/** Per-participant extended time (RF-622): 1×, 1.5×, 2× or no limit, sent as `host.set_time`. */
function TimeSelect({ person, disabled, onChange }: { person: HostParticipant; disabled: boolean; onChange: (multiplier: TimeMultiplier) => void }) {
  const { t } = useI18n();
  const id = useId();
  const value = normalizeTimeMultiplier(person.time_multiplier);
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {t("quizPresent.participants.timeLabel", { name: person.display_name })}
      </label>
      <select
        id={id}
        value={String(value)}
        disabled={disabled}
        title={t("quizPresent.participants.timeHint")}
        onChange={(event) => onChange(normalizeTimeMultiplier(Number(event.target.value)))}
        className="focus-ring h-8 max-w-[9.5rem] rounded-md border border-line bg-surface px-2 text-xs font-medium text-fg disabled:opacity-60"
      >
        {TIME_MULTIPLIERS.map((option) => (
          <option key={option} value={String(option)}>
            {t(`quizPresent.participants.times.${TIME_KEY[option]}`)}
          </option>
        ))}
      </select>
    </>
  );
}

/** The host's own phone preview in the list (RF-514): it never enters reports. */
function PreviewBadge() {
  const { t } = useI18n();
  return (
    <span title={t("quizPresent.moderation.previewLabel")} className="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-primary-soft px-1.5 text-[0.6875rem] font-semibold text-primary">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 fill-none stroke-current" strokeWidth="1.5">
        <rect x="4.5" y="1.5" width="7" height="13" rx="1.6" />
      </svg>
      {t("quizPresent.moderation.previewBadge")}
      <span className="sr-only">: {t("quizPresent.moderation.previewLabel")}</span>
    </span>
  );
}

function BotBadge() {
  const { t } = useI18n();
  return (
    <span title={t("quizPresent.participants.botLabel")} className="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-surface-muted px-1.5 text-[0.6875rem] font-semibold text-fg-muted">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="10" height="8" rx="2" />
        <path d="M8 5V2.5M6 9h.01M10 9h.01" />
      </svg>
      {t("quizPresent.participants.bot")}
      <span className="sr-only">: {t("quizPresent.participants.botLabel")}</span>
    </span>
  );
}

/** Participants drawer: extended time per person, kick / kick-and-ban (confirmed). */
export function ParticipantsPanel({
  open,
  onClose,
  participants,
  onKick,
  onSetTime,
  canSetTime = true
}: {
  open: boolean;
  onClose: () => void;
  participants: HostParticipant[];
  onKick: (participantId: string, ban: boolean) => void;
  onSetTime: (participantId: string, multiplier: TimeMultiplier) => void;
  /** False while the socket is not open (commands are not queued). */
  canSetTime?: boolean;
}) {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState<{ person: HostParticipant; ban: boolean } | null>(null);
  const sorted = [...participants].sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name, locale));
  return (
    <>
      <Dialog open={open} onClose={onClose} placement="right" title={`${t("quizPresent.participants.title")} (${participants.length})`}>
        {sorted.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("quizPresent.participants.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {sorted.map((person) => (
              <li key={person.participant_id} className="flex flex-col gap-2 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar seed={person.avatar_seed} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-fg">{person.display_name}</span>
                      {person.is_bot ? <BotBadge /> : null}
                      {person.is_preview ? <PreviewBadge /> : null}
                      <TimeBadge multiplier={normalizeTimeMultiplier(person.time_multiplier)} />
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <span aria-hidden="true" className={cn("size-2 rounded-full", person.connected ? "bg-success" : "bg-fg-subtle")} />
                      {person.connected ? t("quizPresent.participants.online") : t("quizPresent.participants.offline")} ·{" "}
                      {t("quizPresent.participants.score", { score: new Intl.NumberFormat(locale).format(person.score) })}
                    </p>
                  </div>
                </div>
                {/* Actions on their own line: the name never gets squeezed by the controls. */}
                <div className="flex flex-wrap items-center gap-2 pl-11">
                  <TimeSelect person={person} disabled={!canSetTime} onChange={(multiplier) => onSetTime(person.participant_id, multiplier)} />
                  <Button size="sm" variant="ghost" onClick={() => setPending({ person, ban: false })}>
                    {t("quizPresent.participants.kick")}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setPending({ person, ban: true })}>
                    {t("quizPresent.participants.ban")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <ConfirmDialog
        open={pending !== null}
        title={t("quizPresent.participants.kickConfirmTitle", { name: pending?.person.display_name ?? "" })}
        message={t("quizPresent.participants.kickConfirmText")}
        confirmLabel={pending?.ban ? t("quizPresent.participants.ban") : t("quizPresent.participants.kick")}
        cancelLabel={t("quizPresent.controls.cancel")}
        tone="danger"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) {
            onKick(pending.person.participant_id, pending.ban);
          }
          setPending(null);
        }}
      />
    </>
  );
}

export function HotkeysHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const rows: Array<[string[], string]> = [
    [["Space", "→", "PageDown"], t("quizPresent.hotkeys.next")],
    [["L"], t("quizPresent.hotkeys.lock")],
    [["R"], t("quizPresent.hotkeys.reveal")],
    [["B"], t("quizPresent.hotkeys.leaderboard")],
    [["F"], t("quizPresent.hotkeys.fullscreen")],
    [["P"], t("quizPresent.hotkeys.pause")],
    [["+"], t("quizPresent.hotkeys.extend")],
    [["Z"], t("quizPresent.hotkeys.calm")],
    [["H"], t("quizPresent.hotkeys.controls")],
    [["?"], t("quizPresent.hotkeys.help")]
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t("quizPresent.hotkeys.title")} footer={<Button onClick={onClose}>{t("quizPresent.hotkeys.close")}</Button>}>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
        {rows.map(([keys, label]) => (
          <div key={label} className="contents">
            <dt className="flex gap-1">
              {keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </dt>
            <dd className="text-sm text-fg">{label}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
