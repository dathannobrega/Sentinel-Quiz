// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LiveMotionProvider } from "@/components/quiz-kit/motion";
import type { LiveSubmission } from "@/features/quiz-live/lib/live-store";
import type { PublicQuestion, Reveal } from "@/features/quiz-live/lib/protocol";
import { AnswerPad } from "@/features/quiz-play/components/answer-pad";
import { formatAnswer } from "@/features/quiz-play/components/my-results";
import { RevealFeedback, SubmittedView } from "@/features/quiz-play/components/participant-phases";
import { I18nProvider } from "@/lib/i18n/provider";
import type { AppLocale } from "@/lib/i18n/core";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() })
}));

function wrap(node: ReactNode, locale: AppLocale = "en-US") {
  return (
    <I18nProvider locale={locale} localeFromCookie>
      <LiveMotionProvider>
        <div data-lq-theme="sentinel">{node}</div>
      </LiveMotionProvider>
    </I18nProvider>
  );
}

const base: PublicQuestion = {
  qi: 0,
  item_type: "ordering",
  prompt: "Order the incident response phases",
  options: [
    { id: "o_c", text: "Containment", index: 0 },
    { id: "o_p", text: "Preparation", index: 1 },
    { id: "o_d", text: "Detection", index: 2 }
  ],
  allow_multiple: false,
  body: null,
  time_limit_s: 45,
  points_multiplier: 1,
  scored: true,
  select_count: null,
  numeric: null,
  max_words: null
};

const numericQuestion: PublicQuestion = {
  ...base,
  item_type: "numeric",
  prompt: "How many bits in an AES-256 key?",
  options: [],
  numeric: { min: 0, max: 5000, step: 0.5, unit: "bits" }
};

const cloudQuestion: PublicQuestion = { ...base, item_type: "word_cloud", options: [], scored: false, points_multiplier: 0, max_words: 2 };

afterEach(() => cleanup());

describe("OrderingPad", () => {
  it("starts in the received order, moves with the up/down buttons and announces the new position", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={base} onSubmit={onSubmit} />));
    const items = () => screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items()[0]).toContain("Containment");
    // WCAG 2.5.7: every item has both buttons, and they are 44 px targets.
    const up = screen.getByRole("button", { name: "Move “Preparation” up (position 2)" });
    expect(up.className).toContain("size-11");
    expect((screen.getByRole("button", { name: "Move “Containment” up (position 1)" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move “Detection” down (position 3)" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(up);
    expect(items()[0]).toContain("Preparation");
    expect(screen.getByText("“Preparation” is now in position 1 of 3.")).toBeTruthy();
    // The pressed button is now disabled (first slot): focus stays on the item.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move “Preparation” down (position 1)");

    fireEvent.click(screen.getByRole("button", { name: "Move “Containment” down (position 2)" }));
    expect(items().map((text) => text?.replace(/\d/g, ""))).toEqual(["Preparation", "Detection", "Containment"]);

    fireEvent.click(screen.getByRole("button", { name: "Submit order" }));
    expect(onSubmit).toHaveBeenCalledWith({ choice: ["o_p", "o_d", "o_c"] });
    fireEvent.click(screen.getByRole("button", { name: "Submit order" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables everything while the answers are closed", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={base} disabled onSubmit={onSubmit} />));
    fireEvent.click(screen.getByRole("button", { name: "Submit order" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Move “Preparation” up (position 2)" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("NumericPad", () => {
  it("reads pt-BR input (1.234,5) and sends a JSON number; the slider follows", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={numericQuestion} onSubmit={onSubmit} />, "pt-BR"));
    const input = screen.getByLabelText("Seu número");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(screen.getByText("Entre 0 bits e 5.000 bits")).toBeTruthy();
    fireEvent.change(input, { target: { value: "1.234,5" } });
    const slider = screen.getByLabelText("Ou ajuste no controle deslizante") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1234.5);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(onSubmit).toHaveBeenCalledWith({ number: 1234.5 });
  });

  it("reads en-US input (1,234.5) and fills the field from the slider", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={numericQuestion} onSubmit={onSubmit} />));
    const input = screen.getByLabelText("Your number") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1,234.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ number: 1234.5 });

    cleanup();
    render(wrap(<AnswerPad question={numericQuestion} onSubmit={onSubmit} />));
    fireEvent.change(screen.getByLabelText("Or adjust it with the slider"), { target: { value: "256" } });
    expect((screen.getByLabelText("Your number") as HTMLInputElement).value).toBe("256");
  });

  it("shows an inline error out of range or for text, and never sends it", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={numericQuestion} onSubmit={onSubmit} />));
    const input = screen.getByLabelText("Your number");
    fireEvent.change(input, { target: { value: "6000" } });
    expect(screen.getByRole("alert").textContent).toContain("Use a number between 0 bits and 5,000 bits.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const send = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.getByRole("alert").textContent).toContain("That is not a number");
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("WordCloudPad", () => {
  it("offers one field per allowed word, caps each at 25 characters and counts repeats once", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={cloudQuestion} onSubmit={onSubmit} />));
    const first = screen.getByLabelText("Word 1") as HTMLInputElement;
    const second = screen.getByLabelText("Word 2") as HTMLInputElement;
    expect(screen.queryByLabelText("Word 3")).toBeNull();
    fireEvent.change(first, { target: { value: "x".repeat(30) } });
    expect(first.value).toHaveLength(25);
    expect(screen.getByText("25/25")).toBeTruthy();
    fireEvent.change(first, { target: { value: "  Zero Trust " } });
    fireEvent.change(second, { target: { value: "zero trust" } });
    expect(screen.getByText("Repeated words count only once.")).toBeTruthy();
    fireEvent.change(second, { target: { value: "MFA" } });
    fireEvent.click(screen.getByRole("button", { name: "Send 2 words" }));
    expect(onSubmit).toHaveBeenCalledWith({ words: ["Zero Trust", "MFA"] });
  });

  it("needs at least one word", () => {
    const onSubmit = vi.fn();
    render(wrap(<AnswerPad question={{ ...cloudQuestion, max_words: 1 }} onSubmit={onSubmit} />));
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Your word"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

function accepted(answer: LiveSubmission["answer"]): LiveSubmission {
  return { qi: 0, answerId: "a1", answer, status: "accepted", ack: "accepted" };
}

describe("answered view and reveal (phone)", () => {
  it("shows the sent order, number (with unit) and words", () => {
    const { unmount } = render(wrap(<SubmittedView question={base} submission={accepted({ choice: ["o_p", "o_d", "o_c"] })} answered={1} total={3} />));
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1Preparation", "2Detection", "3Containment"]);
    unmount();
    const numeric = render(wrap(<SubmittedView question={numericQuestion} submission={accepted({ number: 1234.5 })} answered={1} total={3} />, "pt-BR"));
    expect(screen.getByText("1.234,5 bits")).toBeTruthy();
    numeric.unmount();
    render(wrap(<SubmittedView question={cloudQuestion} submission={accepted({ words: ["Zero Trust", "MFA"] })} answered={1} total={3} />));
    expect(screen.getByText("Zero Trust")).toBeTruthy();
    expect(screen.getByText("MFA")).toBeTruthy();
  });

  const orderingReveal: Reveal = {
    qi: 0,
    item_type: "ordering",
    correct_option_ids: [],
    accepted_answers: [],
    counts: {},
    answered: 3,
    total: 3,
    pct_correct: 33.3,
    avg_ms: 4000,
    explanation: null,
    ordering: { correct_order_ids: ["o_p", "o_d", "o_c"], slot_pct_correct: [66.7, 33.3, 66.7], exact: 1 },
    my: { answered: true, correct: false, fraction: 0.67, points: 500, total_score: 500, rank: 2, rank_delta: 0, streak: 0 }
  };

  it("ordering: the correct order slot by slot with ✓/✗ for the person's placement", () => {
    render(wrap(<RevealFeedback question={base} reveal={orderingReveal} showCorrect showExplanation submission={accepted({ choice: ["o_d", "o_p", "o_c"] })} />));
    expect(screen.getByRole("heading", { name: "Partially correct" })).toBeTruthy();
    expect(screen.getByText("Correct order")).toBeTruthy();
    expect(screen.getAllByText("wrong position")).toHaveLength(2);
    expect(screen.getAllByText("right position")).toHaveLength(1);
    expect(screen.getByText("You placed: Detection")).toBeTruthy();
  });

  it("ordering with the answer hidden on devices shows only the person's own order", () => {
    const hidden = { ...orderingReveal, ordering: { correct_order_ids: [], slot_pct_correct: [], exact: 1 } };
    render(wrap(<RevealFeedback question={base} reveal={hidden} showCorrect={false} showExplanation submission={accepted({ choice: ["o_d", "o_p", "o_c"] })} />));
    expect(screen.queryByText("Correct order")).toBeNull();
    expect(screen.getByText("Your order")).toBeTruthy();
  });

  it("numeric: correct value ± tolerance, the person's number and the distribution", () => {
    const numericReveal: Reveal = {
      ...orderingReveal,
      item_type: "numeric",
      ordering: undefined,
      numeric: { min: 0, max: 5000, bins: Array.from({ length: 20 }, (_, index) => (index === 0 ? 3 : 0)), n: 3, mean: 262, median: 256, value: 256, tolerance: 10, unit: "bits" }
    };
    render(wrap(<RevealFeedback question={numericQuestion} reveal={numericReveal} showCorrect showExplanation submission={accepted({ number: 275 })} />));
    expect(screen.getByText("256 bits (± 10 bits)")).toBeTruthy();
    expect(screen.getAllByText("275 bits").length).toBeGreaterThan(0);
    expect(screen.getByText("Median: 256 bits")).toBeTruthy();
  });

  it("word cloud: the person's words and the cloud as an accessible list", () => {
    const cloudReveal: Reveal = {
      ...orderingReveal,
      item_type: "word_cloud",
      pct_correct: null,
      ordering: undefined,
      word_cloud: { words: [{ text: "Senha", key: "senha", n: 2 }, { text: "MFA", key: "mfa", n: 1 }], distinct: 2, filtered: 0 },
      my: { answered: true, correct: null, fraction: null, points: 0, total_score: 0, rank: null, rank_delta: 0, streak: 0 }
    };
    render(wrap(<RevealFeedback question={cloudQuestion} reveal={cloudReveal} showCorrect showExplanation submission={accepted({ words: ["MFA"] })} />));
    expect(screen.getByRole("heading", { name: "Answer recorded" })).toBeTruthy();
    expect(screen.getByText("Your words: MFA")).toBeTruthy();
    expect(screen.getAllByText("Senha: 2").length).toBeGreaterThan(0);
  });
});

describe("my results", () => {
  it("formats list and text answers of every type", () => {
    expect(formatAnswer(["Preparation", "Detection"], "ordering")).toBe("Preparation → Detection");
    expect(formatAnswer(["Zero Trust", "MFA"], "word_cloud")).toBe("Zero Trust · MFA");
    expect(formatAnswer("275 bits", "numeric")).toBe("275 bits");
    expect(formatAnswer(["A", "B"], "multi_choice")).toBe("A, B");
    expect(formatAnswer(null)).toBeNull();
    expect(formatAnswer([], "word_cloud")).toBeNull();
  });
});
