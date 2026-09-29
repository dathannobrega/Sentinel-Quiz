// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { passThresholdNote, SessionResultShell } from "@/features/results/components/session-result-shell";
import { ORDERING_FEEDBACK, ORDERING_PAYLOAD } from "@/features/session-runner/lib/pbq-test-fixtures";
import { apiClient } from "@/lib/api/client";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import { I18nProvider } from "@/lib/i18n/provider";
import type { SessionReview } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/exam/s1/result",
  useSearchParams: () => new URLSearchParams()
}));

const { t } = createTranslator(getMessages("en-US"));

const REVIEW = {
  session: {
    id: "s1",
    exam_id: "securityplus",
    exam_title: "Security+",
    created_at: "2026-09-29T10:00:00Z",
    completed_at: "2026-09-29T10:30:00Z",
    selection_strategy: "standard",
    selection_mix: {},
    total_questions: 2,
    correct_count: 1,
    wrong_count: 1,
    score_percent: 66.5
  },
  result: {
    session_id: "s1",
    total_questions: 2,
    correct_count: 1,
    wrong_count: 1,
    score_percent: 66.5,
    passed: false,
    pass_threshold_percent: 83,
    strategy: "standard",
    selection_mix: {},
    time_limit_seconds: null,
    time_spent_seconds: 600,
    timed_out: false,
    insight: {}
  },
  questions: [
    {
      id: "sq_pbq_1",
      prompt: "Resposta a incidentes",
      multi_select: false,
      domain: "Security Operations",
      difficulty: "Medium",
      certification: "Security+",
      options: [],
      correct_keys: [],
      selected_keys: [],
      is_correct: false,
      justification: "Os dois conceitos cobrados juntos.",
      tags: null,
      citations: null,
      format: "pbq",
      pbq: ORDERING_PAYLOAD,
      pbq_response: { t1: ["c", "p", "d"] },
      ...ORDERING_FEEDBACK
    },
    {
      id: "q2",
      prompt: "Qual pilar garante integridade?",
      multi_select: false,
      domain: "General Security Concepts",
      difficulty: "Easy",
      certification: "Security+",
      options: [
        { key: "A", text: "Confidencialidade" },
        { key: "B", text: "Integridade" }
      ],
      correct_keys: ["B"],
      selected_keys: ["B"],
      is_correct: true,
      justification: null,
      tags: null,
      citations: null
    }
  ]
} as unknown as SessionReview;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="en-US" localeFromCookie>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("passThresholdNote", () => {
  it("explains the variable CEH cut score and stays silent for other certifications", () => {
    expect(passThresholdNote("CEH", t)).toBe(t("results.summary.passThresholdNotes.CEH"));
    expect(passThresholdNote("CISSP", t)).toBeNull();
    expect(passThresholdNote(null, t)).toBeNull();
    expect(passThresholdNote("a b", t)).toBeNull();
  });
});

describe("session result with a PBQ", () => {
  it("shows the student's answer against the answer key per task, next to regular MCQs", async () => {
    vi.spyOn(apiClient, "get").mockImplementation(async (path: string) => {
      if (path === "/sessions/s1/review") {
        return REVIEW;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    render(<SessionResultShell sessionId="s1" mode="exam" />, { wrapper });

    const pbq = await screen.findByTestId("pbq-question");
    expect(screen.getByText(t("pbq.review.title"))).toBeTruthy();
    expect(screen.getByText(`${t("pbq.feedback.partialCredit")} · 33%`)).toBeTruthy();
    const task = within(pbq).getByTestId("pbq-task-t1");
    expect(within(task).getByText(t("pbq.ordering.correctOrder"))).toBeTruthy();
    expect(within(task).getByText(t("pbq.ordering.expectedPosition", { position: 3 }))).toBeTruthy();
    expect(within(task).getByText("Preparação vem antes da detecção.")).toBeTruthy();
    // Read-only: no move controls in the review.
    expect(within(pbq).queryByRole("button", { name: /Up: move/ })).toBeNull();
    // The MCQ in the same review still renders its options.
    expect(screen.getByText(/Integridade/)).toBeTruthy();
  });
});
