// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LiveMotionProvider } from "@/components/quiz-kit/motion";
import type { PublicQuestion } from "@/features/quiz-live/lib/protocol";
import { AnswerPad } from "@/features/quiz-play/components/answer-pad";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

function wrap(node: ReactNode) {
  return (
    <I18nProvider locale="en-US" localeFromCookie>
      <LiveMotionProvider>
        <div data-lq-theme="sentinel">{node}</div>
      </LiveMotionProvider>
    </I18nProvider>
  );
}

function question(overrides: Partial<PublicQuestion> = {}): PublicQuestion {
  return {
    qi: 0,
    item_type: "single_choice",
    prompt: "Which port does HTTPS use?",
    options: [
      { id: "A", text: "80", index: 0 },
      { id: "B", text: "443", index: 1 },
      { id: "C", text: "22", index: 2 },
      { id: "D", text: "25", index: 3 }
    ],
    allow_multiple: false,
    body: null,
    time_limit_s: 20,
    points_multiplier: 1,
    scored: true,
    select_count: null,
    ...overrides
  };
}

afterEach(() => cleanup());

describe("AnswerPad", () => {
  it("single choice: one tap sends the answer once, with shape letter and text on every tile", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={question()} onSubmit={onSubmit} />));
    const tiles = screen.getAllByRole("button");
    expect(tiles).toHaveLength(4);
    expect(screen.getByRole("button", { name: "B: 443" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "B: 443" }));
    fireEvent.click(screen.getByRole("button", { name: "A: 80" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ choice: ["B"] });
  });

  it("multi choice: toggles tiles, shows the 'select N' hint and submits the set", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={question({ item_type: "multi_choice", select_count: 2 })} onSubmit={onSubmit} />));
    expect(screen.getByText(/Select 2/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const tileC = screen.getByRole("button", { name: "C: 22" });
    fireEvent.click(tileC);
    fireEvent.click(screen.getByRole("button", { name: "A: 80" }));
    expect(tileC.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "A: 80" }));
    fireEvent.click(screen.getByRole("button", { name: "B: 443" }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ choice: ["B", "C"] });
  });

  it("type answer: sends the trimmed text", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={question({ item_type: "type_answer", options: [] })} onSubmit={onSubmit} />));
    const input = screen.getByLabelText("Your answer");
    fireEvent.change(input, { target: { value: "  firewall  " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledWith({ text: "firewall" });
  });

  it("ignores taps while disabled (reading phase)", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={question({ item_type: "true_false", options: [{ id: "T", text: "True", index: 0 }, { id: "F", text: "False", index: 1 }] })} disabled onSubmit={onSubmit} />));
    fireEvent.click(screen.getByRole("button", { name: "A: True" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
