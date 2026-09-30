"use client";

import { useState } from "react";

import { Avatar } from "@/components/quiz-kit/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import type { LiveConnectionState } from "@/features/quiz-live/lib/live-store";
import type { HostParticipant } from "@/features/quiz-live/lib/protocol";
import { availableActions, contextualAction, type HostAction, type HostContext } from "@/features/quiz-present/lib/host-actions";
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

export interface HostControlBarProps {
  context: HostContext;
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
        {primary !== "next" && available.next ? (
          <button type="button" onClick={() => run("next")} disabled={!online} className={barSecondary}>
            {t(ACTION_LABEL.next)}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
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

/** Participants drawer with kick / kick-and-ban (confirmed). */
export function ParticipantsPanel({
  open,
  onClose,
  participants,
  onKick
}: {
  open: boolean;
  onClose: () => void;
  participants: HostParticipant[];
  onKick: (participantId: string, ban: boolean) => void;
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
              <li key={person.participant_id} className="flex items-center gap-3 py-2.5">
                <Avatar seed={person.avatar_seed} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{person.display_name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <span aria-hidden="true" className={cn("size-2 rounded-full", person.connected ? "bg-success" : "bg-fg-subtle")} />
                    {person.connected ? t("quizPresent.participants.online") : t("quizPresent.participants.offline")} ·{" "}
                    {t("quizPresent.participants.score", { score: new Intl.NumberFormat(locale).format(person.score) })}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPending({ person, ban: false })}>
                  {t("quizPresent.participants.kick")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setPending({ person, ban: true })}>
                  {t("quizPresent.participants.ban")}
                </Button>
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
