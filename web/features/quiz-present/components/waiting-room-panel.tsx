"use client";

import { useEffect, useId, useState } from "react";

import { Avatar } from "@/components/quiz-kit/avatar";
import { Dialog } from "@/components/ui/dialog";
import { waitingTotal } from "@/features/quiz-live/lib/live-store";
import type { WaitingPerson, WaitingRoomState } from "@/features/quiz-live/lib/protocol";
import { CapacityWarning } from "@/features/quiz-present/components/room-ops";
import { CAPACITY_STEP, clampCapacity, parseCapacity, visibleApproval, waitedFor } from "@/features/quiz-present/lib/waiting-room";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

/** What the panel asks the host shell to send (`host.admit/reject/set_capacity/set_approval`). */
export interface WaitingRoomActions {
  admit: (target: "all" | string[]) => void;
  reject: (requestId: string) => void;
  setCapacity: (maxParticipants: number) => void;
  setApproval: (required: boolean) => void;
}

const TONES = {
  live: {
    muted: "text-lq-fg-muted",
    text: "text-lq-fg",
    line: "border-lq-line",
    box: "border-lq-line bg-lq-surface-2",
    button: "border border-lq-line bg-lq-surface text-lq-fg hover:bg-lq-surface-2",
    primary: "bg-lq-accent text-lq-on-accent hover:brightness-110",
    danger: "border border-lq-danger bg-lq-surface text-lq-danger hover:bg-lq-surface-2",
    input: "border-lq-line bg-lq-surface text-lq-fg",
    online: "bg-lq-success",
    offline: "bg-lq-fg-muted",
    badge: "bg-lq-surface-2 text-lq-fg",
    accent: "accent-[var(--lq-accent)]"
  },
  app: {
    muted: "text-fg-muted",
    text: "text-fg",
    line: "border-line",
    box: "border-line bg-surface-muted",
    button: "border border-line bg-surface text-fg hover:bg-surface-muted",
    primary: "bg-primary text-on-primary hover:brightness-110",
    danger: "border border-danger bg-surface text-danger hover:bg-surface-muted",
    input: "border-line bg-surface text-fg",
    online: "bg-success",
    offline: "bg-fg-subtle",
    badge: "bg-primary-soft text-primary",
    accent: "accent-primary"
  }
} as const;

/** Re-renders every 30 s so "há 2 min" stays right while the panel is open. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Host waiting room (Incremento 7 §4/§7): the "Aprovar a entrada" switch, the people awaiting
 * approval (name, on the page or not, how long, signed in) with Aprovar/Recusar and "Aprovar
 * todos", the capacity queue size and the room cap (up to the platform's). A decision hides the
 * person at once; the server's next snapshot confirms it.
 */
export function WaitingRoomPanel({
  room,
  participantCount,
  actions,
  disabled = false,
  tone = "live"
}: {
  room: WaitingRoomState;
  participantCount: number;
  actions: WaitingRoomActions;
  /** False while the socket is not open (commands are not queued). */
  disabled?: boolean;
  tone?: keyof typeof TONES;
}) {
  const { t, locale } = useI18n();
  const styles = TONES[tone];
  const now = useNow();
  const toggleId = useId();
  const toggleHintId = useId();
  const capacityId = useId();
  const capacityHintId = useId();
  const format = new Intl.NumberFormat(locale);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });

  // Decided locally, until the next waiting-room block from the server (which replaces `room`).
  const [decided, setDecided] = useState<{ room: WaitingRoomState; ids: ReadonlySet<string> }>({ room, ids: new Set() });
  const decidedIds = decided.room === room ? decided.ids : new Set<string>();
  if (decided.room !== room) {
    setDecided({ room, ids: new Set() });
  }
  const decide = (ids: string[]) => setDecided({ room, ids: new Set([...decidedIds, ...ids]) });

  // The cap being typed; null = follow the server's value.
  const [draft, setDraft] = useState<string | null>(null);
  const shownCap = draft ?? String(room.max_participants);
  const parsedCap = parseCapacity(shownCap, room.platform_max);
  const capError = draft !== null && parsedCap === null ? t("quizPresent.waiting.capacityInvalid", { max: format.format(room.platform_max) }) : null;
  const capDirty = parsedCap !== null && parsedCap !== room.max_participants;

  const people = visibleApproval(room, decidedIds);
  const approvalLeft = Math.max(0, room.approval_count - decidedIds.size);
  const more = Math.max(0, approvalLeft - people.length);
  const button = cn(
    "focus-ring inline-flex min-h-9 shrink-0 items-center justify-center rounded-md px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60",
    styles.button
  );

  function waited(person: WaitingPerson): string {
    const value = waitedFor(person.created_at, now);
    return value.unit === "now" ? t("quizPresent.waiting.waitedNow") : relative.format(-value.value, value.unit);
  }

  function step(delta: number) {
    const base = parsedCap ?? room.max_participants;
    setDraft(String(clampCapacity(base + delta, room.platform_max)));
  }

  function applyCap() {
    if (parsedCap === null || !capDirty) {
      return;
    }
    actions.setCapacity(parsedCap);
    setDraft(null);
  }

  return (
    <div className="flex min-h-0 flex-col gap-5">
      {/* Approval switch */}
      <div className={cn("flex items-start gap-3 rounded-md border p-3", styles.box)}>
        <input
          id={toggleId}
          type="checkbox"
          role="switch"
          checked={room.require_approval}
          disabled={disabled}
          aria-describedby={toggleHintId}
          onChange={(event) => actions.setApproval(event.target.checked)}
          className={cn("mt-0.5 size-5 shrink-0 cursor-pointer disabled:cursor-not-allowed", styles.accent)}
        />
        <span className="flex flex-col gap-0.5">
          <label htmlFor={toggleId} className={cn("cursor-pointer text-sm font-semibold", styles.text)}>
            {t("quizPresent.waiting.approvalToggle")}
          </label>
          <span id={toggleHintId} className={cn("text-xs", styles.muted)}>
            {t("quizPresent.waiting.approvalToggleHint")}
          </span>
        </span>
      </div>

      {/* Awaiting approval */}
      <section className="flex flex-col gap-2" aria-labelledby={`${toggleId}-approval`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${toggleId}-approval`} className={cn("text-xs font-bold tracking-[0.12em] uppercase", styles.muted)}>
            {t("quizPresent.waiting.approvalTitle")} · {format.format(approvalLeft)}
          </h3>
          {approvalLeft > 0 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                actions.admit("all");
                decide(people.map((person) => person.request_id));
              }}
              className={cn(button, "ml-auto border-0", styles.primary)}
            >
              {t("quizPresent.waiting.admitAll", { count: format.format(approvalLeft) })}
            </button>
          ) : null}
        </div>
        {people.length === 0 ? (
          <p className={cn("text-sm", styles.muted)}>
            {room.require_approval ? t("quizPresent.waiting.approvalEmpty") : t("quizPresent.waiting.approvalOff")}
          </p>
        ) : (
          <ul className={cn("flex max-h-80 flex-col divide-y overflow-y-auto", styles.line)} aria-label={t("quizPresent.waiting.approvalTitle")}>
            {people.map((person) => (
              <li key={person.request_id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 py-2", styles.line)}>
                <Avatar seed={person.avatar_seed} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("truncate text-sm font-semibold", styles.text)}>{person.display_name}</span>
                    {person.signed_in ? (
                      <span title={t("quizPresent.waiting.signedInLabel")} className={cn("inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[0.6875rem] font-semibold", styles.badge)}>
                        {t("quizPresent.waiting.signedIn")}
                        <span className="sr-only">: {t("quizPresent.waiting.signedInLabel")}</span>
                      </span>
                    ) : null}
                  </p>
                  <p className={cn("flex items-center gap-1.5 text-xs", styles.muted)}>
                    <span aria-hidden="true" className={cn("size-2 rounded-full", person.connected ? styles.online : styles.offline)} />
                    {person.connected ? t("quizPresent.waiting.online") : t("quizPresent.waiting.offline")} ·{" "}
                    <time dateTime={person.created_at}>{waited(person)}</time>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={t("quizPresent.waiting.admitLabel", { name: person.display_name })}
                    onClick={() => {
                      actions.admit([person.request_id]);
                      decide([person.request_id]);
                    }}
                    className={cn(button, "border-0", styles.primary)}
                  >
                    {t("quizPresent.waiting.admit")}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={t("quizPresent.waiting.rejectLabel", { name: person.display_name })}
                    onClick={() => {
                      actions.reject(person.request_id);
                      decide([person.request_id]);
                    }}
                    className={cn(button, styles.danger)}
                  >
                    {t("quizPresent.waiting.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {more > 0 ? <p className={cn("text-xs", styles.muted)}>{t("quizPresent.waiting.more", { count: format.format(more) })}</p> : null}
      </section>

      {/* Capacity queue */}
      <section className="flex flex-col gap-1">
        <h3 className={cn("text-xs font-bold tracking-[0.12em] uppercase", styles.muted)}>{t("quizPresent.waiting.queueTitle")}</h3>
        <p className={cn("text-sm font-semibold", styles.text)}>
          {room.capacity_count === 0
            ? t("quizPresent.waiting.queueEmpty")
            : room.capacity_count === 1
              ? t("quizPresent.waiting.queueOne")
              : t("quizPresent.waiting.queueMany", { count: format.format(room.capacity_count) })}
        </p>
        <p className={cn("text-xs", styles.muted)}>{t("quizPresent.waiting.queueHint")}</p>
      </section>

      {/* Room cap */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={cn("text-xs font-bold tracking-[0.12em] uppercase", styles.muted)}>{t("quizPresent.waiting.capacityTitle")}</h3>
          <CapacityWarning count={participantCount} max={room.max_participants} className="ml-auto" />
        </div>
        <p className={cn("text-sm", styles.text)}>
          {t("quizPresent.waiting.capacityUsage", { count: format.format(participantCount), max: format.format(room.max_participants) })}
        </p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyCap();
          }}
        >
          <label htmlFor={capacityId} className="sr-only">
            {t("quizPresent.waiting.capacityLabel")}
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={disabled}
              aria-label={t("quizPresent.waiting.capacityDecrease", { step: CAPACITY_STEP })}
              onClick={() => step(-CAPACITY_STEP)}
              className={cn(button, "w-9 px-0 font-lq-mono text-base")}
            >
              −
            </button>
            <input
              id={capacityId}
              type="number"
              inputMode="numeric"
              min={1}
              max={room.platform_max}
              step={1}
              value={shownCap}
              disabled={disabled}
              aria-invalid={capError ? true : undefined}
              aria-describedby={capacityHintId}
              onChange={(event) => setDraft(event.target.value)}
              className={cn("focus-ring h-9 w-24 rounded-md border px-2 text-center font-lq-mono text-sm tabular-nums disabled:opacity-60", styles.input)}
            />
            <button
              type="button"
              disabled={disabled}
              aria-label={t("quizPresent.waiting.capacityIncrease", { step: CAPACITY_STEP })}
              onClick={() => step(CAPACITY_STEP)}
              className={cn(button, "w-9 px-0 font-lq-mono text-base")}
            >
              +
            </button>
          </div>
          <button type="submit" disabled={disabled || !capDirty} className={cn(button, "border-0", styles.primary)}>
            {t("quizPresent.waiting.capacityApply")}
          </button>
        </form>
        <p id={capacityHintId} className={cn("text-xs", capError ? "font-semibold text-lq-danger" : styles.muted, capError && tone === "app" && "text-danger")}>
          {capError ?? t("quizPresent.waiting.capacityHint", { max: format.format(room.platform_max) })}
        </p>
        {parsedCap !== null && capDirty && parsedCap < participantCount ? <p className={cn("text-xs", styles.muted)}>{t("quizPresent.waiting.capacityBelow")}</p> : null}
      </section>
    </div>
  );
}

/** Same panel in a side dialog for the stage view (opened from the control bar). */
export function WaitingRoomDialog({
  open,
  onClose,
  room,
  ...props
}: {
  open: boolean;
  onClose: () => void;
  room: WaitingRoomState | null;
  participantCount: number;
  actions: WaitingRoomActions;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const count = waitingTotal(room);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      placement="right"
      title={count ? `${t("quizPresent.waiting.title")} (${count})` : t("quizPresent.waiting.title")}
      description={t("quizPresent.waiting.description")}
      showCloseButton
    >
      {room ? <WaitingRoomPanel room={room} {...props} tone="app" /> : null}
    </Dialog>
  );
}
