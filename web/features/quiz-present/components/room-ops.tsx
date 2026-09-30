"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "motion/react";

import { useLqReducedMotion } from "@/components/quiz-kit/motion";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { credentialsFromJoin, createPreview, getPreflight, type ParticipantCredentials } from "@/features/quiz-live/lib/live-fetch";
import { PlayScreen } from "@/features/quiz-play/components/play-screen";
import {
  capacityLevel,
  capacityPercent,
  normalizePreflightStatus,
  preflightDetail,
  preflightKey,
  preflightOverall,
  preflightValues,
  sortPreflightChecks
} from "@/features/quiz-present/lib/room-ops";
import { ApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LivePreflight, LivePreflightCheck, LivePreflightStatus } from "@/types/api/live";

// ----------------------------------------------------------------------------- capacity (RF-1205)

/**
 * Warning pill once the room reaches 80% of its limit (and "full" at the limit). Renders nothing
 * below the threshold or when the server did not send the limit.
 */
export function CapacityWarning({ count, max, className }: { count: number; max: number | null; className?: string }) {
  const { t } = useI18n();
  const level = capacityLevel(count, max);
  if (level === "ok" || max === null) {
    return null;
  }
  const text =
    level === "full" ? t("quizPresent.capacity.full", { count, max }) : t("quizPresent.capacity.near", { count, max, percent: capacityPercent(count, max) });
  return (
    <span
      role="status"
      title={t("quizPresent.capacity.hint")}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold motion-safe:animate-[rise-in_220ms_ease-out_both]",
        level === "full" ? "bg-lq-danger text-lq-on-danger" : "bg-lq-warning text-lq-on-warning",
        className
      )}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="6" cy="5" r="2.2" />
        <path d="M2 13c.4-2.4 2-3.6 4-3.6s3.6 1.2 4 3.6M11 4.5v4M11 11h.01" />
      </svg>
      {text}
      <span className="sr-only">. {t("quizPresent.capacity.hint")}</span>
    </span>
  );
}

// ----------------------------------------------------------------------------- pre-event check (RF-1115)

export type PreflightRun =
  | { kind: "idle" }
  | { kind: "running"; previous: LivePreflight | null }
  | { kind: "done"; result: LivePreflight; at: number }
  | { kind: "error" };

/** Runs GET /preflight on demand; `run` ignores calls while one is in flight. */
export function usePreflight(sessionId: string) {
  const [state, setState] = useState<PreflightRun>({ kind: "idle" });
  const inFlight = useRef<AbortController | null>(null);

  const run = useCallback(async (): Promise<LivePreflight | null> => {
    if (inFlight.current) {
      return null;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    setState((current) => ({ kind: "running", previous: current.kind === "done" ? current.result : null }));
    try {
      const result = await getPreflight(sessionId, controller.signal);
      setState({ kind: "done", result, at: Date.now() });
      return result;
    } catch {
      if (!controller.signal.aborted) {
        setState({ kind: "error" });
      }
      return null;
    } finally {
      inFlight.current = null;
    }
  }, [sessionId]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const result = state.kind === "done" ? state.result : state.kind === "running" ? state.previous : null;
  const overall = result ? preflightOverall(result) : null;
  return { state, run, result, overall };
}

const STATUS_STYLE: Record<LivePreflightStatus, { box: string; mark: string }> = {
  ok: { box: "bg-success-soft text-success", mark: "✓" },
  warn: { box: "bg-warning-soft text-warning", mark: "!" },
  fail: { box: "bg-danger-soft text-danger", mark: "✕" }
};

function CheckValues({ check }: { check: LivePreflightCheck }) {
  const { t } = useI18n();
  const values = preflightValues(check);
  const parts: string[] = [];
  if (preflightKey(check) === "capacity" && values.max_participants !== undefined) {
    parts.push(
      t("quizPresent.preflight.values.capacity", {
        participants: values.participants ?? 0,
        max: values.max_participants,
        platform: values.platform_limit ?? "—"
      })
    );
  }
  if (typeof values.latency_ms === "number") {
    parts.push(t("quizPresent.preflight.values.latency", { ms: values.latency_ms }));
  }
  if (typeof values.p95_ms === "number") {
    parts.push(t("quizPresent.preflight.values.p95", { ms: values.p95_ms }));
  }
  if (typeof values.backend === "string") {
    parts.push(t("quizPresent.preflight.values.backend", { backend: values.backend }));
  }
  return parts.length ? <p className="font-mono text-xs text-fg-subtle">{parts.join(" · ")}</p> : null;
}

/** The check list with an overall "Pronto" / "Atenção" verdict (drawer on the host screen). */
export function PreflightDialog({
  open,
  onClose,
  preflight
}: {
  open: boolean;
  onClose: () => void;
  preflight: ReturnType<typeof usePreflight>;
}) {
  const { t, locale } = useI18n();
  const { state, run, result, overall } = preflight;
  const running = state.kind === "running";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      placement="right"
      title={t("quizPresent.preflight.title")}
      description={t("quizPresent.preflight.description")}
      footer={
        <Button variant="secondary" busy={running} busyLabel={t("quizPresent.preflight.running")} onClick={() => void run()}>
          {t("quizPresent.preflight.run")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4" aria-busy={running || undefined}>
        {state.kind === "error" ? <Alert tone="danger" role="alert" message={t("quizPresent.preflight.error")} /> : null}
        {!result && running ? (
          <p role="status" className="text-sm text-fg-muted">
            {t("quizPresent.preflight.running")}
          </p>
        ) : null}
        {result && overall ? (
          <>
            <Alert
              tone={overall === "ready" ? "success" : "warning"}
              title={overall === "ready" ? t("quizPresent.preflight.ready") : t("quizPresent.preflight.attention")}
              message={overall === "ready" ? t("quizPresent.preflight.readyText") : t("quizPresent.preflight.attentionText")}
            />
            {result.large_room ? <p className="text-xs text-fg-muted">{t("quizPresent.preflight.largeRoom")}</p> : null}
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line" aria-label={t("quizPresent.preflight.title")}>
              {sortPreflightChecks(result.checks).map((check, index) => {
                const status = normalizePreflightStatus(check.status);
                const style = STATUS_STYLE[status];
                return (
                  <li key={`${check.key}-${index}`} className="flex items-start gap-3 px-3 py-2.5">
                    <span aria-hidden="true" className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-black", style.box)}>
                      {style.mark}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-fg">
                        {t(`quizPresent.preflight.keys.${preflightKey(check)}`)}
                        <span className={cn("text-xs font-medium", status === "ok" ? "text-success" : status === "warn" ? "text-warning" : "text-danger")}>
                          {t(`quizPresent.preflight.statuses.${status}`)}
                        </span>
                      </p>
                      <p className="text-sm text-fg-muted">{t(`quizPresent.preflight.details.${preflightDetail(check)}`)}</p>
                      <CheckValues check={check} />
                    </div>
                  </li>
                );
              })}
            </ul>
            {state.kind === "done" ? (
              <p className="text-xs text-fg-subtle">
                {t("quizPresent.preflight.checkedAt", { time: new Date(state.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Small verdict chip next to the "Checagem pré-evento" button. */
export function PreflightChip({ overall }: { overall: "ready" | "attention" | null }) {
  const { t } = useI18n();
  if (!overall) {
    return null;
  }
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[0.7rem] font-bold", overall === "ready" ? "bg-lq-success text-lq-on-success" : "bg-lq-warning text-lq-on-warning")}>
      {overall === "ready" ? t("quizPresent.preflight.ready") : t("quizPresent.preflight.attention")}
    </span>
  );
}

// ----------------------------------------------------------------------------- phone preview (RF-514)

export type PreviewState = { kind: "closed" } | { kind: "opening" } | { kind: "open"; credentials: ParticipantCredentials } | { kind: "error"; message: string };

/** Opens the rehearsal phone preview (POST /preview), reusing the credentials while open. */
export function usePhonePreview(sessionId: string) {
  const { t } = useI18n();
  const [state, setState] = useState<PreviewState>({ kind: "closed" });

  const open = useCallback(async () => {
    setState({ kind: "opening" });
    try {
      const result = await createPreview(sessionId);
      setState({ kind: "open", credentials: credentialsFromJoin(result) });
    } catch (error) {
      const code = error instanceof ApiError && (error.code === "preview_requires_rehearsal" || error.code === "session_finished") ? error.code : "generic";
      setState({ kind: "error", message: t(`quizPresent.preview.errors.${code}`) });
    }
  }, [sessionId, t]);

  const close = useCallback(() => setState({ kind: "closed" }), []);
  const toggle = useCallback(() => {
    if (state.kind === "open" || state.kind === "opening") {
      close();
    } else {
      void open();
    }
  }, [state.kind, open, close]);
  return { state, open, close, toggle, active: state.kind === "open" || state.kind === "opening" };
}

/**
 * The REAL participant client (same PlayScreen, its own socket) inside a phone frame beside the
 * stage. The page CSP forbids framing, so it is mounted in place rather than in an iframe.
 */
export function PhonePreviewPanel({
  state,
  onClose,
  bottomInset,
  code
}: {
  state: PreviewState;
  onClose: () => void;
  bottomInset: number;
  code: string;
}) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  if (state.kind === "closed") {
    return null;
  }
  return (
    <m.aside
      aria-label={t("quizPresent.preview.title")}
      className="fixed top-3 right-3 z-30 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2"
      style={{ bottom: bottomInset + 12 }}
      initial={reduced ? false : { x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.12 }}
    >
      <div className="flex items-center gap-2 rounded-[calc(var(--lq-radius)*0.6)] border border-lq-line bg-lq-surface px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-lq-fg">{t("quizPresent.preview.title")}</p>
          <p className="text-xs text-lq-fg-muted">{t("quizPresent.preview.hint")}</p>
        </div>
        <button type="button" onClick={onClose} className="focus-ring rounded-md px-2 py-1 text-sm font-semibold text-lq-fg-muted hover:text-lq-fg" aria-label={t("quizPresent.preview.hide")}>
          ✕
        </button>
      </div>
      <div
        role="region"
        aria-label={t("quizPresent.preview.frameLabel")}
        className="relative min-h-0 flex-1 overflow-hidden rounded-[2rem] border-[6px] border-lq-line bg-lq-bg shadow-[0_30px_70px_-30px_rgb(0_0_0/0.8)]"
      >
        {state.kind === "open" ? (
          <div className="absolute inset-0 overflow-y-auto overscroll-contain">
            <PlayScreen code={code} credentials={state.credentials} embedded onTokenLost={onClose} onLeave={onClose} onErased={onClose} />
          </div>
        ) : state.kind === "opening" ? (
          <p role="status" className="grid h-full place-items-center p-6 text-center text-sm text-lq-fg-muted">
            {t("quizPresent.preview.opening")}
          </p>
        ) : (
          <p role="alert" className="grid h-full place-items-center p-6 text-center text-sm font-semibold text-lq-fg">
            {state.message}
          </p>
        )}
      </div>
    </m.aside>
  );
}
