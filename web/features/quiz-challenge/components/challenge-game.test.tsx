// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ChallengeGame } from "@/features/quiz-challenge/components/challenge-game";
import { attemptState, question } from "@/features/quiz-challenge/lib/test-fixtures";
import * as api from "@/lib/api/live-challenge";
import { I18nProvider } from "@/lib/i18n/provider";
import type { LiveAttemptSummary, LiveChallengeInfo } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));
// jsdom never finishes exit animations: AnimatePresence "wait" would keep the previous step forever.
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</> };
});
vi.mock("@/lib/api/live-challenge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/live-challenge")>();
  return {
    ...actual,
    getCurrentAttempt: vi.fn(),
    startAttempt: vi.fn(),
    submitChallengeAnswer: vi.fn(),
    advanceAttempt: vi.fn(),
    finishAttempt: vi.fn(),
    getChallengeLeaderboard: vi.fn()
  };
});
const mocked = vi.mocked(api);

const INFO: LiveChallengeInfo = {
  session_id: "s1",
  slug: "SLUG0001",
  title: "Phishing",
  theme_key: "sentinel",
  state: "open",
  opens_at: "2026-10-01T00:00:00+00:00",
  closes_at: "2099-10-08T12:00:00+00:00",
  server_now: "2026-10-01T12:00:00+00:00",
  item_count: 3,
  attempts: 2,
  time_mode: "per_item",
  total_time_s: null,
  feedback: "each",
  leaderboard: false,
  requires_login: false,
  allow_guests: true,
  audience: "adulto",
  consent_version: "v1"
};
const CREDENTIALS = { token: "tok", expiresAt: "2099-01-01T00:00:00Z", sessionId: "s1", participantId: "p1", displayName: "Ana", avatarSeed: "a" };

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="pt-BR" localeFromCookie>
      {children}
    </I18nProvider>
  );
}

function show(info: LiveChallengeInfo = INFO) {
  return render(<ChallengeGame slug="SLUG0001" info={info} credentials={CREDENTIALS} onTokenLost={vi.fn()} onLeave={vi.fn()} />, { wrapper: Wrapper });
}

const SUMMARY: LiveAttemptSummary = {
  score: 900,
  correct: 1,
  answered: 2,
  questions: 2,
  scored_questions: 2,
  duration_ms: 65_000,
  finish_reason: "completed",
  attempts_left: 1,
  best_score: 900,
  rank: null,
  ranked: 0,
  corrections_visible: false,
  corrections_at: "2099-10-08T12:00:00+00:00",
  items: []
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("ChallengeGame", () => {
  it("before the first attempt shows the rules and starts on 'Começar'", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    mocked.getCurrentAttempt.mockRejectedValue(new ApiError({ code: "attempt_not_found", message: "x", status: 404 }));
    mocked.startAttempt.mockResolvedValue(attemptState({ feedback: "each" }));
    show();
    expect(await screen.findByText("Como funciona")).toBeTruthy();
    expect(screen.getByText("3 perguntas")).toBeTruthy();
    expect(screen.getByText("2 tentativas")).toBeTruthy();
    expect(screen.getByText("Você vê a correção logo depois de cada resposta")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Começar" }));
    });
    expect(mocked.startAttempt).toHaveBeenCalledWith("SLUG0001", "tok");
    expect(await screen.findByText("Pergunta 4")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("Item 1 de 3");
  });

  it("policy each: correction with the running score; 'Próxima' reveals the pending item and starts its clock", async () => {
    mocked.getCurrentAttempt
      .mockResolvedValueOnce(attemptState({ feedback: "each", score: 0 }))
      .mockResolvedValueOnce(attemptState({ feedback: "each", index: 1, item: question(7), score: 900 }));
    mocked.submitChallengeAnswer.mockResolvedValue({
      status: "accepted",
      // The next item is not sent and its clock has not started (CONTRATO-INCREMENTO-6 §3).
      state: attemptState({ feedback: "each", index: 1, item: null, item_started_at: null, item_deadline_at: null, next_pending: true, score: 900 }),
      feedback: {
        qi: 4,
        item_type: "single_choice",
        answered: true,
        correct: false,
        fraction: 0,
        points: 0,
        correct_option_ids: ["o_4a"],
        accepted_answers: [],
        explanation: "Treinamento reduz o risco.",
        your_answer: { choice: ["o_4b"] }
      }
    });
    show();
    const option = await screen.findByRole("button", { name: "B: B" });
    await act(async () => {
      fireEvent.click(option);
    });
    expect(mocked.submitChallengeAnswer.mock.calls[0]?.[3]).toMatchObject({ qi: 4, choice: ["o_4b"] });
    expect(await screen.findByText("Não foi dessa vez")).toBeTruthy();
    expect(screen.getByText("Treinamento reduz o risco.")).toBeTruthy();
    expect(screen.getByText("900 pontos no total")).toBeTruthy();
    // No countdown while the next item is pending: reading the correction is free.
    expect(screen.queryByRole("timer")).toBeNull();
    expect(mocked.getCurrentAttempt).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    });
    expect(mocked.getCurrentAttempt).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Pergunta 7")).toBeTruthy();
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("late: 'Tempo esgotado' toast and the next item from the returned state", async () => {
    mocked.getCurrentAttempt.mockResolvedValue(attemptState());
    mocked.submitChallengeAnswer.mockResolvedValue({ status: "late", state: attemptState({ index: 1, item: question(5) }) });
    show();
    const option = await screen.findByRole("button", { name: "A: A" });
    await act(async () => {
      fireEvent.click(option);
    });
    expect(await screen.findByText("Pergunta 5")).toBeTruthy();
    expect(screen.getAllByText("Tempo esgotado").length).toBeGreaterThan(0);
  });

  it("finished (after_close): summary, when the key comes out and 'Tentar de novo'", async () => {
    mocked.getCurrentAttempt.mockResolvedValue(attemptState({ status: "finished", item: null, index: 3, feedback: "after_close", summary: SUMMARY }));
    show({ ...INFO, feedback: "after_close" });
    expect(await screen.findByText("Tentativa concluída")).toBeTruthy();
    expect(screen.getByText("900 pontos")).toBeTruthy();
    expect(screen.getByText("1 min 5 s")).toBeTruthy();
    expect(screen.getByText(/A correção sai depois do prazo/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(screen.getByText("Resta 1 tentativa.")).toBeTruthy();
    expect(screen.getByText("Tentativas usadas")).toBeTruthy();
  });

  it("finished (end): the corrections list with your answer and the key", async () => {
    const items = [
      {
        qi: 4,
        item_type: "single_choice" as const,
        answered: true,
        correct: false,
        fraction: 0,
        points: 0,
        correct_option_ids: ["o_4a"],
        accepted_answers: [],
        explanation: null,
        your_answer: { choice: ["o_4b"] },
        prompt: "Qual controle mitiga phishing?",
        question: question(4, { options: [{ id: "o_4a", text: "Treinamento", index: 0 }, { id: "o_4b", text: "Post-it", index: 1 }] })
      }
    ];
    mocked.getCurrentAttempt.mockResolvedValue(
      attemptState({ status: "finished", item: null, index: 3, feedback: "end", summary: { ...SUMMARY, corrections_visible: true, corrections_at: null, attempts_left: 0, items } })
    );
    show({ ...INFO, feedback: "end" });
    expect(await screen.findByText("Qual controle mitiga phishing?")).toBeTruthy();
    expect(screen.getByText("Post-it")).toBeTruthy();
    expect(screen.getByText("Treinamento")).toBeTruthy();
    expect(screen.getByText("Errada")).toBeTruthy();
    // No running score outside policy "each".
    expect(screen.queryByText(/pontos no total/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });
});
