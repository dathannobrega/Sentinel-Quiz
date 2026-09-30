"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";

import { CountdownRing } from "@/components/quiz-kit/countdown-ring";
import { OptionBadge } from "@/components/quiz-kit/option-shape";
import { LiveThemeRoot, PauseGlyph } from "@/features/quiz-live/components/live-chrome";
import { LqButton, LqInput } from "@/features/quiz-live/components/lq-ui";
import type { LiveState } from "@/features/quiz-live/lib/live-store";
import { useLive, useLiveState } from "@/features/quiz-live/lib/use-live-session";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

const selectPresenter = (state: LiveState) => ({
  themeKey: state.themeKey,
  title: state.title,
  phase: state.phase,
  qi: state.qi,
  total: state.total,
  question: state.question,
  timer: state.timer,
  counts: state.counts,
  answered: state.answered,
  answerTotal: state.answerTotal,
  participantCount: state.participantCount,
  reveal: state.reveal,
  presenter: state.presenter,
  presenterQi: state.presenterQi
});

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-h-0 flex-col gap-3 rounded-[var(--lq-radius)] border border-lq-line bg-lq-surface p-4", className)}>
      <h2 className="text-xs font-bold tracking-[0.14em] text-lq-fg-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Presenter view (`?view=presenter`): answer key, notes, next item, live counts and the timer.
 * This is the only surface that renders presenter data; it is never used as the projected stage.
 */
export function PresenterView({ controls }: { controls: ReactNode }) {
  const { t } = useI18n();
  const live = useLive();
  const view = useLiveState(selectPresenter);
  const [acceptText, setAcceptText] = useState("");
  const [acceptedNote, setAcceptedNote] = useState<string | null>(null);
  const acceptId = useId();

  const question = view.question;
  const presenterFresh = view.presenter && view.presenterQi === view.qi ? view.presenter : null;
  const item = presenterFresh?.item ?? null;
  // Public option ids are opaque per session; the presenter item lists the same options in
  // the same order, so the answer key is matched by display index (never by id/key).
  const correctIds = new Set<string>(
    item && question
      ? question.options.filter((option) => item.options[option.index]?.correct).map((option) => option.id)
      : (view.reveal?.correct_option_ids ?? [])
  );
  const keyKnown = Boolean(item) || Boolean(view.reveal);
  const counts = view.counts ?? {};
  const totalAnswers = Math.max(1, view.answered ?? 0);
  const canAccept = question?.item_type === "type_answer" && (view.phase === "locked" || view.phase === "reveal");

  function onAccept(event: FormEvent) {
    event.preventDefault();
    const text = acceptText.trim();
    if (!text || view.qi === null) {
      return;
    }
    live.send({ type: "host.accept_answer", data: { qi: view.qi, text } }, { queueWhileOffline: false });
    setAcceptedNote(t("quizPresent.presenter.accepted_ok", { text }));
    setAcceptText("");
  }

  return (
    <LiveThemeRoot theme={view.themeKey} backdrop={false} className="min-h-dvh">
      <div className="flex min-h-dvh flex-col">
        <p role="note" className="bg-lq-warning px-4 py-2 text-center text-sm font-bold text-lq-on-warning">
          {t("quizPresent.presenter.privateWarning")}
        </p>
        <header className="flex flex-wrap items-center gap-3 px-5 pt-4">
          <h1 className="font-lq text-xl font-extrabold text-lq-fg">{t("quizPresent.presenter.title")}</h1>
          <span className="truncate text-sm text-lq-fg-muted">{view.title}</span>
          {view.qi !== null && view.total ? (
            <span className="ml-auto rounded-full bg-lq-surface-2 px-3 py-1 font-lq-mono text-sm text-lq-fg">
              {t("quizPresent.intro.counter", { current: view.qi + 1, total: view.total })}
            </span>
          ) : null}
        </header>

        <main className="grid min-h-0 flex-1 gap-4 p-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-4">
            <Panel title={t("quizPresent.presenter.current")}>
              {question ? (
                <>
                  <div className="flex items-start gap-4">
                    <p className="flex-1 font-lq-prompt text-2xl leading-snug font-bold text-lq-fg">{question.prompt}</p>
                    {view.phase === "question" && view.timer?.paused ? (
                      <span role="status" className="lq-paused-breathe inline-flex shrink-0 items-center gap-1.5 self-center rounded-full bg-lq-warning px-3 py-1 text-sm font-bold text-lq-on-warning">
                        <PauseGlyph className="size-3.5" />
                        {t("quizPresent.question.paused")}
                      </span>
                    ) : null}
                    {view.phase === "question" && view.timer?.deadline_ms ? (
                      <CountdownRing
                        timer={view.timer}
                        clock={live.clock}
                        size={84}
                        label={(value) => (value.paused ? t("quizPresent.question.pausedTime", { seconds: value.seconds }) : t("quizPresent.question.timeLeft", { seconds: value.seconds }))}
                      />
                    ) : null}
                  </div>
                  {question.options.length ? (
                    <ul className="flex flex-col gap-2" aria-label={t("quizPresent.presenter.answerKey")}>
                      {[...question.options]
                        .sort((a, b) => a.index - b.index)
                        .map((option) => {
                          const correct = correctIds.has(option.id);
                          const count = counts[option.id] ?? 0;
                          return (
                            <li key={option.id} className={cn("lq-tile relative flex items-center gap-3 overflow-hidden px-3 py-2", `lq-slot-${option.index % 6}`)} data-dim={keyKnown && !correct ? true : undefined}>
                              <span
                                aria-hidden="true"
                                className="absolute inset-y-0 left-0 w-full origin-left bg-[color-mix(in_srgb,var(--lq-on-tile)_14%,transparent)] transition-transform duration-300"
                                style={{ transform: `scaleX(${count / totalAnswers})` }}
                              />
                              <OptionBadge index={option.index} size="sm" className="relative" />
                              <span className="relative min-w-0 flex-1 font-semibold">{option.text}</span>
                              {correct ? (
                                <span className="relative rounded-full bg-lq-success px-2 py-0.5 text-xs font-bold text-lq-on-success">✓ {t("quizPresent.presenter.correctMark")}</span>
                              ) : null}
                              <span className="relative font-lq-mono text-sm tabular-nums">{count}</span>
                            </li>
                          );
                        })}
                    </ul>
                  ) : null}
                  {!keyKnown && question.options.length ? <p className="text-sm text-lq-fg-muted">{t("quizPresent.presenter.answerKeyStale")}</p> : null}
                  {typeof view.answered === "number" ? (
                    <p className="font-lq-mono text-sm text-lq-fg-muted">
                      {t("quizPresent.question.answered", { answered: view.answered, total: view.answerTotal ?? view.participantCount })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-lq-fg-muted">{t("quizPresent.presenter.lobby")}</p>
              )}
            </Panel>

            {question?.item_type === "type_answer" ? (
              <Panel title={t("quizPresent.presenter.accepted")}>
                {item?.accepted_answers.length ? <p className="text-lq-fg">{item.accepted_answers.join(" · ")}</p> : null}
                {view.reveal?.top_answers?.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {view.reveal.top_answers.map((answer) => (
                      <li key={answer.text} className={cn("rounded-full border px-3 py-1 text-sm", answer.accepted ? "border-lq-success text-lq-fg" : "border-lq-line text-lq-fg-muted")}>
                        {answer.accepted ? "✓ " : ""}
                        {answer.text} · {answer.n}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {canAccept ? (
                  <form onSubmit={onAccept} className="flex flex-col gap-2">
                    <label htmlFor={acceptId} className="text-sm font-semibold text-lq-fg">
                      {t("quizPresent.presenter.acceptTitle")}
                    </label>
                    <p className="text-xs text-lq-fg-muted">{t("quizPresent.presenter.acceptHint")}</p>
                    <div className="flex gap-2">
                      <LqInput id={acceptId} value={acceptText} onChange={(event) => setAcceptText(event.target.value)} placeholder={t("quizPresent.presenter.acceptPlaceholder")} maxLength={60} className="min-h-11 text-base" />
                      <LqButton type="submit" disabled={!acceptText.trim()}>
                        {t("quizPresent.presenter.accept")}
                      </LqButton>
                    </div>
                    {acceptedNote ? (
                      <p role="status" className="text-sm text-lq-fg">
                        {acceptedNote}
                      </p>
                    ) : null}
                  </form>
                ) : null}
              </Panel>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col gap-4">
            <Panel title={t("quizPresent.presenter.notes")}>
              <p className="whitespace-pre-line text-lq-fg">{item?.presenter_notes || t("quizPresent.presenter.noNotes")}</p>
            </Panel>
            {item?.explanation || view.reveal?.explanation ? (
              <Panel title={t("quizPresent.presenter.explanation")}>
                <p className="font-serif leading-relaxed whitespace-pre-line text-lq-fg">{item?.explanation ?? view.reveal?.explanation}</p>
              </Panel>
            ) : null}
            <Panel title={t("quizPresent.presenter.next")}>
              <p className="text-lq-fg">{presenterFresh?.next_prompt ?? (view.qi !== null && view.qi >= view.total - 1 ? t("quizPresent.presenter.noNext") : "—")}</p>
            </Panel>
          </div>
        </main>
        <div className="sticky bottom-0 z-10">{controls}</div>
      </div>
    </LiveThemeRoot>
  );
}
