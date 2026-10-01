// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ChallengePanel } from "@/features/quiz-challenge/components/challenge-panel";
import { funnelPercents } from "@/features/quiz-challenge/components/challenge-widgets";
import { ChallengeReportBlock } from "@/features/quiz-reports/components/challenge-report";
import { ParticipantsTable } from "@/features/quiz-reports/components/participants-table";
import { I18nProvider } from "@/lib/i18n/provider";
import type { LiveChallenge, LiveChallengeProgress } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

afterEach(() => cleanup());

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider locale="pt-BR" localeFromCookie>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  );
}

const CHALLENGE: LiveChallenge = {
  slug: "7K3QH2XN",
  share_url: "https://arena.example/q/7K3QH2XN",
  state: "open",
  opens_at: "2026-10-01T12:00:00+00:00",
  closes_at: "2099-10-09T23:59:00+00:00",
  attempts: 2,
  time_mode: "per_item",
  total_time_s: null,
  feedback: "after_close",
  leaderboard: true,
  shuffle_items: true
};

const PROGRESS: LiveChallengeProgress = {
  challenge: CHALLENGE,
  funnel: { opened: 40, joined: 31, started: 30, finished: 27 },
  in_progress: 3,
  attempts: 33,
  attempts_per_person: { "1": 28, "2": 2 },
  repeat_suspects: 1,
  median_duration_ms: 312_000,
  recent: [
    { participant_id: "p1", display_name: "Ana", attempt_no: 1, score: 4200, correct: 5, finished_at: "2026-10-02T10:00:00+00:00", finish_reason: "completed", repeat_suspect: false },
    { participant_id: "p2", display_name: "Ana Clone", attempt_no: 1, score: 3900, correct: 4, finished_at: "2026-10-02T10:05:00+00:00", finish_reason: "handed_in", repeat_suspect: true }
  ],
  leaderboard: [
    { rank: 1, participant_id: "p1", display_name: "Ana", avatar_seed: "a", score: 4200, correct: 5 },
    { rank: 2, participant_id: "p2", display_name: "Ana Clone", avatar_seed: "b", score: 3900, correct: 4 }
  ],
  generated_at: "2026-10-02T10:06:00+00:00"
};

describe("ChallengePanel", () => {
  it("shows state, funnel, stats, leaderboard and the repeat mark on recent finishes", () => {
    render(<ChallengePanel quizId="q1" sessionId="s1" progress={PROGRESS} session={null} />, { wrapper: Wrapper });
    expect(screen.getByText("Aberto")).toBeTruthy();
    expect(screen.getByText(/^Fecha em /)).toBeTruthy();
    expect(screen.getByLabelText("Abriram o link: 40")).toBeTruthy();
    expect(screen.getByLabelText("Concluíram: 27")).toBeTruthy();
    expect(screen.getByText("5 min 12 s")).toBeTruthy();
    expect(screen.getByText("28 pessoas")).toBeTruthy();
    const recent = screen.getByRole("heading", { name: "Conclusões recentes" }).closest("section") as HTMLElement;
    const rows = within(recent).getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).queryByText("Repetição?")).toBeNull();
    expect(within(rows[1] as HTMLElement).getByText("Repetição?")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("Entregou antes")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("https://arena.example/q/7K3QH2XN")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Adiar prazo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fechar agora" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver relatório" }).getAttribute("href")).toBe("/quizzes/q1/results/s1");
  });

  it("a closed challenge has no deadline actions", () => {
    render(<ChallengePanel quizId="q1" sessionId="s1" progress={{ ...PROGRESS, challenge: { ...CHALLENGE, state: "closed" } }} session={null} />, { wrapper: Wrapper });
    expect(screen.getByText("Encerrado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fechar agora" })).toBeNull();
  });

  it("funnel bars are relative to the widest step", () => {
    expect(funnelPercents({ opened: 40, joined: 30, started: 20, finished: 10 })).toEqual({ opened: 100, joined: 75, started: 50, finished: 25 });
    // Joining with a stored token skips the "opened" counter: never above 100%.
    expect(funnelPercents({ opened: 0, joined: 2, started: 1, finished: 0 })).toEqual({ opened: 0, joined: 100, started: 50, finished: 0 });
  });
});

describe("report", () => {
  it("challenge block: funnel, attempts, median and repeat count", () => {
    render(
      <ChallengeReportBlock
        block={{
          challenge: CHALLENGE,
          funnel: PROGRESS.funnel,
          attempts: 33,
          attempts_per_person: { "1": 28, "2": 2 },
          repeat_suspects: 1,
          median_duration_ms: 312_000
        }}
      />,
      { wrapper: Wrapper }
    );
    expect(screen.getByText("Tentativas no total")).toBeTruthy();
    expect(screen.getByText("33")).toBeTruthy();
    expect(screen.getByText("5 min 12 s")).toBeTruthy();
    expect(screen.getByText("Possível repetição")).toBeTruthy();
    expect(screen.getByLabelText("Entraram: 31")).toBeTruthy();
    expect(screen.getByText("2 tentativas")).toBeTruthy();
    expect(screen.getByText(/aparelho que outra pessoa já tinha usado/)).toBeTruthy();
  });

  it("flags repeat suspects in the participants table", () => {
    const row = { is_guest: true, rank: 1, score: 10, correct: 1, answered: 1, score_pct: 1, avg_ms: 1000 };
    render(
      <ParticipantsTable
        participants={[
          { ...row, participant_id: "p1", display_name: "Ana" },
          { ...row, participant_id: "p2", display_name: "Ana Clone", rank: 2, repeat_suspect: true }
        ]}
        scoredItems={1}
      />,
      { wrapper: Wrapper }
    );
    const rows = screen.getAllByRole("row");
    expect(within(rows[1] as HTMLElement).queryByText("Repetição?")).toBeNull();
    expect(within(rows[2] as HTMLElement).getByText("Repetição?")).toBeTruthy();
  });
});
