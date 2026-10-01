// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CreateChallengeDialog } from "@/features/quiz-challenge/components/create-challenge-dialog";
import { ApiError } from "@/lib/api/errors";
import * as api from "@/lib/api/live-challenge";
import { I18nProvider } from "@/lib/i18n/provider";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));
vi.mock("@/lib/api/live-challenge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/live-challenge")>();
  return { ...actual, createChallenge: vi.fn() };
});
const createChallenge = vi.mocked(api.createChallenge);

const NOW = new Date(2026, 9, 1, 10, 0).getTime();
const QUIZ = { id: "q1", title: "Phishing", has_unpublished_changes: false, published_version_no: 3 };

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="pt-BR" localeFromCookie>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  );
}

function show(quiz = QUIZ) {
  return render(<CreateChallengeDialog open onClose={vi.fn()} quiz={quiz} now={() => NOW} />, { wrapper: Wrapper });
}

function radio(name: string): HTMLInputElement {
  return screen.getByRole("radio", { name: new RegExp(name) }) as HTMLInputElement;
}

beforeEach(() => {
  push.mockReset();
  createChallenge.mockReset();
});
afterEach(() => cleanup());

describe("CreateChallengeDialog", () => {
  it("the default correction follows the leaderboard toggle, with the RF-813 login tip", () => {
    show();
    expect(radio("Ao terminar").checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Mostrar ranking/ }));
    expect(radio("Depois do prazo").checked).toBe(true);
    expect(screen.getByText(/vale exigir login/)).toBeTruthy();
    // The tip offers "Exigir login" in one click.
    const loginBox = screen.getByRole("checkbox", { name: /^Exigir login/ }) as HTMLInputElement;
    expect(loginBox.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Exigir login" }));
    expect(loginBox.checked).toBe(true);
  });

  it("an explicit correction choice is kept when the leaderboard changes", () => {
    show();
    fireEvent.click(radio("A cada pergunta"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Mostrar ranking/ }));
    expect(radio("A cada pergunta").checked).toBe(true);
  });

  it("creates with the defaults and opens the panel", async () => {
    createChallenge.mockResolvedValue({ id: "s9", quiz_id: "q1" } as Awaited<ReturnType<typeof api.createChallenge>>);
    show();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Criar desafio/ }));
    });
    expect(createChallenge).toHaveBeenCalledTimes(1);
    expect(createChallenge.mock.calls[0]?.[0]).toMatchObject({
      quiz_id: "q1",
      opens_at: null,
      attempts: 1,
      time_mode: "per_item",
      feedback: null,
      leaderboard: false,
      shuffle_items: true,
      allow_guests: true
    });
    expect(push).toHaveBeenCalledWith("/quizzes/q1/challenges/s9");
  });

  it("validates before sending", async () => {
    show();
    fireEvent.click(radio("Tempo total"));
    fireEvent.change(screen.getByLabelText(/Minutos para a tentativa/), { target: { value: "0" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Criar desafio/ }));
    });
    expect(screen.getByText("Use um número inteiro de 1 a 240 minutos.")).toBeTruthy();
    expect(createChallenge).not.toHaveBeenCalled();
  });

  it("maps backend errors to friendly copy", async () => {
    createChallenge.mockRejectedValue(new ApiError({ code: "invalid_window", message: "x", status: 422 }));
    show();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Criar desafio/ }));
    });
    expect(screen.getByText(/Confira as datas/)).toBeTruthy();
  });

  it("needs a published version", () => {
    show({ ...QUIZ, published_version_no: null as unknown as number });
    expect(screen.getByText(/Publique o quiz para criar um desafio/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Criar desafio/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
