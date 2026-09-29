// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { QuestionOptions } from "@/features/session-runner/components/question-options";
import type { AnswerFeedback } from "@/features/session-runner/lib/runner-utils";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import type { OptionItem } from "@/types/api";

const { t } = createTranslator(getMessages("en-US"));

const OPTIONS: OptionItem[] = [
  { key: "A", text: "Alpha" },
  { key: "B", text: "Bravo" },
  { key: "C", text: "Charlie" },
  { key: "D", text: "Delta" }
];

function feedbackFor(overrides: Partial<AnswerFeedback>): AnswerFeedback {
  return {
    is_correct: false,
    justification: null,
    feedback_summary: null,
    progress_index: 1,
    total_questions: 10,
    answered_count: 1,
    correct_count: 0,
    wrong_count: 1,
    finished: false,
    official_references: [],
    insight: null,
    current_position: 1,
    marked_for_review_count: 0,
    ...overrides
  } as AnswerFeedback;
}

/** Controlled harness mirroring the runner: single select replaces, multi select toggles. */
function Harness({
  multiSelect = false,
  initial = [],
  feedback = null,
  disabled = false,
  onToggle
}: {
  multiSelect?: boolean;
  initial?: string[];
  feedback?: AnswerFeedback | null;
  disabled?: boolean;
  onToggle?: (key: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <>
      <h2 id="q-heading">Question</h2>
      <QuestionOptions
        questionId="q1"
        options={OPTIONS}
        multiSelect={multiSelect}
        selectedKeys={selected}
        disabled={disabled}
        feedback={feedback}
        labelledBy="q-heading"
        onToggle={(key) => {
          onToggle?.(key);
          setSelected((current) =>
            multiSelect ? (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]) : [key]
          );
        }}
        t={t}
      />
    </>
  );
}

function tabStops(role: "radio" | "checkbox") {
  return screen.getAllByRole(role).filter((element) => element.getAttribute("tabindex") === "0");
}

afterEach(() => cleanup());

describe("QuestionOptions keyboard navigation (single select)", () => {
  it("exposes a labelled radiogroup with a single tab stop (roving tabindex)", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("aria-labelledby")).toBe("q-heading");
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(tabStops("radio")).toEqual([radios[0]]);
    expect(radios.every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("moves focus and selection with the arrow keys, wrapping around", () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    const radios = screen.getAllByRole("radio");

    fireEvent.keyDown(radios[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[1]);
    expect(onToggle).toHaveBeenLastCalledWith("B");
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(tabStops("radio")).toEqual([radios[1]]);

    fireEvent.keyDown(radios[1], { key: "ArrowUp" });
    fireEvent.keyDown(radios[0], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radios[3]);
    expect(radios[3].getAttribute("aria-checked")).toBe("true");
    expect(tabStops("radio")).toEqual([radios[3]]);
  });

  it("supports Home/End", () => {
    render(<Harness initial={["B"]} />);
    const radios = screen.getAllByRole("radio");
    expect(tabStops("radio")).toEqual([radios[1]]);

    fireEvent.keyDown(radios[1], { key: "End" });
    expect(document.activeElement).toBe(radios[3]);
    fireEvent.keyDown(radios[3], { key: "Home" });
    expect(document.activeElement).toBe(radios[0]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
  });

  it("selects with the letter and number shortcuts", () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    const radios = screen.getAllByRole("radio");

    fireEvent.keyDown(document.body, { key: "c" });
    expect(onToggle).toHaveBeenLastCalledWith("C");
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radios[2]);

    fireEvent.keyDown(document.body, { key: "4" });
    expect(onToggle).toHaveBeenLastCalledWith("D");
    expect(radios[3].getAttribute("aria-checked")).toBe("true");
  });

  it("ignores shortcuts while disabled or with modifier keys", () => {
    const onToggle = vi.fn();
    const { unmount } = render(<Harness onToggle={onToggle} disabled />);
    fireEvent.keyDown(document.body, { key: "a" });
    expect(onToggle).not.toHaveBeenCalled();
    unmount();

    render(<Harness onToggle={onToggle} />);
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("QuestionOptions keyboard navigation (multi select)", () => {
  it("uses checkboxes; arrows only move focus and Space toggles", () => {
    const onToggle = vi.fn();
    render(<Harness multiSelect onToggle={onToggle} />);
    expect(screen.getByRole("group")).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox");

    fireEvent.keyDown(boxes[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(boxes[1]);
    expect(onToggle).not.toHaveBeenCalled();

    fireEvent.keyDown(boxes[1], { key: " " });
    expect(onToggle).toHaveBeenLastCalledWith("B");
    expect(boxes[1].getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(boxes[1], { key: "Enter" });
    expect(boxes[1].getAttribute("aria-checked")).toBe("false");
  });
});

describe("QuestionOptions correctness indicators", () => {
  it("marks the wrong selection and the answer key with text, not only color", () => {
    render(<Harness initial={["B"]} disabled feedback={feedbackFor({ is_correct: false, correct_keys: ["C"] })} />);
    const radios = screen.getAllByRole("radio");

    expect(radios[1].textContent).toContain(t("runner.option.wrong"));
    expect(radios[2].textContent).toContain(t("runner.option.answerKey"));
    expect(radios[0].textContent).not.toContain(t("runner.option.wrong"));
    expect(radios[0].textContent).not.toContain(t("runner.option.answerKey"));
    // Every option carries an accessible "Option X" prefix.
    expect(radios[0].textContent).toContain(t("runner.option.optionLabel", { key: "A" }));
  });

  it("marks a correct selection as correct", () => {
    render(<Harness initial={["C"]} disabled feedback={feedbackFor({ is_correct: true, correct_keys: ["C"] })} />);
    const radios = screen.getAllByRole("radio");
    expect(radios[2].textContent).toContain(t("runner.option.correct"));
    expect(screen.queryByText(t("runner.option.wrong"), { exact: false })).toBeNull();
  });

  it("shows no correctness when feedback is withheld (exam-day mode)", () => {
    render(<Harness initial={["B"]} disabled feedback={null} />);
    expect(screen.queryByText(t("runner.option.wrong"), { exact: false })).toBeNull();
    expect(screen.queryByText(t("runner.option.correct"), { exact: false })).toBeNull();
  });
});
