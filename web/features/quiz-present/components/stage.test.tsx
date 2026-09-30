// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LiveMotionProvider } from "@/components/quiz-kit/motion";
import { ClockSync } from "@/features/quiz-live/lib/clock-sync";
import { createInitialLiveState, liveReducer, selectStageView, type StageView } from "@/features/quiz-live/lib/live-store";
import type { PublicQuestion, Reveal, Snapshot } from "@/features/quiz-live/lib/protocol";
import { Stage } from "@/features/quiz-present/components/stage";
import { RevealFeedback } from "@/features/quiz-play/components/participant-phases";
import { I18nProvider } from "@/lib/i18n/provider";
import type { LiveItem } from "@/types/api/live";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

function wrap(node: ReactNode) {
  return (
    <I18nProvider locale="en-US" localeFromCookie>
      <LiveMotionProvider features="max">{node}</LiveMotionProvider>
    </I18nProvider>
  );
}

const question: PublicQuestion = {
  qi: 0,
  item_type: "single_choice",
  prompt: "Which port does HTTPS use by default?",
  options: [
    { id: "A", text: "80", index: 0 },
    { id: "B", text: "443", index: 1 },
    { id: "C", text: "22", index: 2 }
  ],
  allow_multiple: false,
  body: null,
  time_limit_s: 20,
  points_multiplier: 1,
  scored: true,
  select_count: null
};

const reveal: Reveal = {
  qi: 0,
  item_type: "single_choice",
  correct_option_ids: ["B"],
  accepted_answers: [],
  counts: { A: 2, B: 7, C: 1 },
  answered: 10,
  total: 12,
  pct_correct: 70,
  avg_ms: 5400,
  fastest: { display_name: "Bia", ms: 1200 },
  explanation: "TLS on 443.",
  my: { answered: true, correct: false, fraction: 0, points: 0, total_score: 900, rank: 4, rank_delta: -1, streak: 0 }
};

function baseSnapshot(): Snapshot {
  return {
    session_id: "s1",
    title: "Network basics",
    theme_key: "neon_soc",
    join_code: "482913",
    join_url: "https://quiz.example.com/j/482913",
    status: "live",
    phase: "lobby",
    qi: null,
    total: 5,
    settings: { scoring: "speed", show_live_distribution: false, show_correct_on_device: true, show_explanation: true, music: false, reading_phase_s: 0 },
    room_locked: false,
    participant_count: 2
  };
}

function stageView(overrides: Partial<Snapshot>): StageView {
  const snapshot: Snapshot = {
    session_id: "s1",
    title: "Network basics",
    theme_key: "neon_soc",
    join_code: "482913",
    join_url: "https://quiz.example.com/j/482913",
    status: "live",
    phase: "lobby",
    qi: null,
    total: 5,
    settings: { scoring: "speed", show_live_distribution: false, show_correct_on_device: true, show_explanation: true, music: false, reading_phase_s: 0 },
    room_locked: false,
    participant_count: 2,
    presenter: { item: { presenter_notes: "SECRET NOTE", options: [{ key: "B", text: "443", correct: true }] } as unknown as LiveItem, next_prompt: "Next" },
    ...overrides
  };
  const state = liveReducer(createInitialLiveState("host"), { type: "server", message: { v: 1, type: "room.snapshot", sts: 0, data: snapshot } });
  return selectStageView(state);
}

const clock = new ClockSync({ now: () => 50_000 });

afterEach(() => cleanup());

describe("Stage", () => {
  it("lobby: QR, spaced PIN, join host and names", () => {
    render(
      wrap(
        <Stage
          clock={clock}
          view={stageView({
            status: "lobby",
            lobby: { count: 2, recent: [{ participant_id: "p1", display_name: "Ana", avatar_seed: "a" }, { participant_id: "p2", display_name: "Bia", avatar_seed: "b" }] }
          })}
        />
      )
    );
    expect(screen.getByRole("img", { name: /QR code to join at https:\/\/quiz\.example\.com\/j\/482913/ })).toBeTruthy();
    expect(screen.getByText("482 913")).toBeTruthy();
    expect(screen.getByText("quiz.example.com/j")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(document.querySelector("[data-lq-theme='neon_soc']")).toBeTruthy();
    expect(document.body.textContent).not.toContain("SECRET NOTE");
  });

  it("open question: prompt, tiles, answered counter; never the answer key", () => {
    render(
      wrap(
        <Stage
          clock={clock}
          view={stageView({ phase: "question", qi: 0, question, timer: { answers_open_at_ms: 0, deadline_ms: 60_000 }, answered: 3 })}
        />
      )
    );
    expect(screen.getAllByText(question.prompt).length).toBeGreaterThan(0);
    expect(screen.getByText("443")).toBeTruthy();
    expect(screen.getByText("3 of 2 answered")).toBeTruthy();
    expect(screen.getByRole("timer")).toBeTruthy();
    expect(document.body.textContent).not.toContain("SECRET NOTE");
    expect(document.body.textContent).not.toMatch(/Correct/);
  });

  it("locked question shows the lock reason", () => {
    const view = { ...stageView({ phase: "locked", qi: 0, question, timer: { answers_open_at_ms: 0, deadline_ms: 1 } }), lockReason: "all_answered" as const };
    render(wrap(<Stage clock={clock} view={view} />));
    expect(screen.getByText("Answers locked")).toBeTruthy();
    expect(screen.getByText("Everyone answered!")).toBeTruthy();
  });

  it("reveal renders after the suspense beat, with stats and explanation", async () => {
    render(wrap(<Stage clock={clock} view={stageView({ phase: "reveal", qi: 0, question, reveal })} />));
    expect(await screen.findByText("70% got it right", undefined, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText("TLS on 443.")).toBeTruthy();
    expect(screen.getByText(/B, 443: 7 answers \(70%\), correct/)).toBeTruthy();
  });

  it("leaderboard and finished screens", () => {
    const top = [
      { rank: 1, participant_id: "p2", display_name: "Bia", avatar_seed: "b", score: 1800, correct: 2, delta: 2 },
      { rank: 2, participant_id: "p1", display_name: "Ana", avatar_seed: "a", score: 900, correct: 1, delta: -1 }
    ];
    const { unmount } = render(wrap(<Stage clock={clock} view={stageView({ phase: "leaderboard", qi: 0, leaderboard: { top, total: 2 } })} />));
    expect(screen.getByText("Biggest climb")).toBeTruthy();
    expect(screen.getByText("up 2 places")).toBeTruthy();
    unmount();
    render(wrap(<Stage clock={clock} reportHref="/quizzes/q1/results/s1" view={stageView({ phase: "finished", status: "finished" })} />));
    expect(screen.getByRole("link", { name: "Open report" }).getAttribute("href")).toBe("/quizzes/q1/results/s1");
  });
});

describe("Stage: moderation (Incremento 4)", () => {
  it("a removed item is a neutral slide: no prompt, no options", () => {
    const removed: PublicQuestion = { ...question, item_type: "content", prompt: "", options: [], scored: false, points_multiplier: 0, removed: true };
    render(wrap(<Stage clock={clock} view={stageView({ phase: "content", qi: 0, question: removed })} />));
    expect(screen.getByRole("heading", { name: "Content removed by moderation" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("443");
  });

  it("item.removed on the open question swaps the stage to the neutral slide", () => {
    let state = liveReducer(createInitialLiveState("host"), {
      type: "server",
      message: { v: 1, type: "room.snapshot", sts: 0, seq: 3, data: { ...baseSnapshot(), phase: "question", qi: 0, question, timer: { answers_open_at_ms: 0, deadline_ms: 60_000 } } }
    });
    state = liveReducer(state, { type: "server", message: { v: 1, type: "item.removed", sts: 10, seq: 4, data: { qi: 0, current: true } } });
    render(wrap(<Stage clock={clock} view={selectStageView(state)} />));
    expect(screen.getByRole("heading", { name: "Content removed by moderation" })).toBeTruthy();
    expect(document.body.textContent).not.toContain(question.prompt);
  });

  it("masked typed answers render as a muted pill with an accessible label", async () => {
    const typed: PublicQuestion = { ...question, item_type: "type_answer", options: [] };
    const typedReveal: Reveal = {
      ...reveal,
      item_type: "type_answer",
      correct_option_ids: [],
      counts: {},
      accepted_answers: ["443"],
      top_answers: [
        { text: "443", n: 5, accepted: true },
        { text: "•••", n: 2, accepted: false, masked: true },
        { text: "•••", n: 1, accepted: false, masked: true }
      ]
    };
    render(wrap(<Stage clock={clock} view={stageView({ phase: "reveal", qi: 0, question: typed, reveal: typedReveal })} />));
    const masked = await screen.findAllByRole("img", { name: "Answer hidden by moderation" }, { timeout: 2000 });
    expect(masked).toHaveLength(2);
  });
});

describe("RevealFeedback (phone)", () => {
  it("incorrect: icon + words + the correct option, never colour alone", () => {
    render(wrap(<div data-lq-theme="sentinel"><RevealFeedback question={question} reveal={reveal} showCorrect showExplanation /></div>));
    expect(screen.getByRole("heading", { name: "Not this time" })).toBeTruthy();
    expect(screen.getByText(/The correct answer was ◆ B/)).toBeTruthy();
    expect(screen.getByText("Why?")).toBeTruthy();
  });

  it("correct: points and rank", () => {
    const correct = { ...reveal, my: { answered: true, correct: true, fraction: 1, points: 870, total_score: 1770, rank: 2, rank_delta: 2, streak: 3 } };
    render(wrap(<div data-lq-theme="sentinel"><RevealFeedback question={question} reveal={correct} showCorrect showExplanation={false} /></div>));
    expect(screen.getByRole("heading", { name: "Correct!" })).toBeTruthy();
    expect(screen.getByText("+870")).toBeTruthy();
    expect(screen.getByText("3 in a row")).toBeTruthy();
    expect(screen.getByText("up 2")).toBeTruthy();
  });
});
