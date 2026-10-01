// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { OptionEditor } from "@/features/quiz-builder/components/editor/option-editor";
import { TypePickerGrid } from "@/features/quiz-builder/components/editor/type-picker-dialog";
import { I18nProvider } from "@/lib/i18n/provider";
import type { LiveItemOption, LiveItemType } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/quizzes/q1/edit"
}));

afterEach(() => cleanup());

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en-US" localeFromCookie>
      {children}
    </I18nProvider>
  );
}

const THREE: LiveItemOption[] = [
  { key: "A", text: "443", correct: true },
  { key: "B", text: "80", correct: false },
  { key: "C", text: "22", correct: false }
];

function Harness({
  type,
  initial,
  onChange
}: {
  type: "single_choice" | "multi_choice" | "true_false" | "poll";
  initial: LiveItemOption[];
  onChange?: (options: LiveItemOption[]) => void;
}) {
  const [options, setOptions] = useState(initial);
  return (
    <OptionEditor
      type={type}
      options={options}
      onChange={(next) => {
        setOptions(next);
        onChange?.(next);
      }}
    />
  );
}

describe("OptionEditor", () => {
  it("labels every text field and correct toggle, and toggles several correct options (single choice)", () => {
    const onChange = vi.fn();
    render(<Harness type="single_choice" initial={THREE} onChange={onChange} />, { wrapper: Wrapper });
    expect((screen.getByLabelText("Text for option A") as HTMLInputElement).value).toBe("443");
    const toggleB = screen.getByLabelText("Option B is correct") as HTMLInputElement;
    expect(toggleB.type).toBe("checkbox");
    fireEvent.click(toggleB);
    expect(onChange).toHaveBeenLastCalledWith([
      { key: "A", text: "443", correct: true },
      { key: "B", text: "80", correct: true },
      { key: "C", text: "22", correct: false }
    ]);
  });

  it("adds up to 6 options and removes down to 2", () => {
    render(<Harness type="multi_choice" initial={THREE} />, { wrapper: Wrapper });
    const add = screen.getByRole("button", { name: /Add option/ }) as HTMLButtonElement;
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getAllByLabelText(/^Text for option/)).toHaveLength(6);
    expect(add.disabled).toBe(true);
    // The new row gets focus for immediate typing.
    expect(document.activeElement).toBe(screen.getByLabelText("Text for option F"));

    for (const letter of ["F", "E", "D", "C"]) {
      fireEvent.click(screen.getByRole("button", { name: `Remove option ${letter}` }));
    }
    expect(screen.getAllByLabelText(/^Text for option/)).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Remove option A" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("true/false is fixed and has exactly-one (radio) semantics", () => {
    const onChange = vi.fn();
    render(
      <Harness
        type="true_false"
        initial={[
          { key: "T", text: "True", correct: true },
          { key: "F", text: "False", correct: false }
        ]}
        onChange={onChange}
      />,
      { wrapper: Wrapper }
    );
    const falseToggle = screen.getByLabelText("Option B is correct") as HTMLInputElement;
    expect(falseToggle.type).toBe("radio");
    fireEvent.click(falseToggle);
    expect(onChange).toHaveBeenLastCalledWith([
      { key: "T", text: "True", correct: false },
      { key: "F", text: "False", correct: true }
    ]);
    expect(screen.queryByRole("button", { name: /Add option/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove option/ })).toBeNull();
    expect((screen.getByLabelText("Text for option A") as HTMLInputElement).readOnly).toBe(true);
  });

  it("polls have no correct toggle", () => {
    render(<Harness type="poll" initial={THREE} />, { wrapper: Wrapper });
    expect(screen.queryByLabelText(/is correct/)).toBeNull();
  });

  it("shows the legibility warning above 60 chars and blocks above 120 (linked to the field)", () => {
    render(<Harness type="single_choice" initial={THREE} />, { wrapper: Wrapper });
    const input = screen.getByLabelText("Text for option A") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(61) } });
    expect(screen.getByText(/Long for the big screen/)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(input, { target: { value: "x".repeat(121) } });
    const message = screen.getByText(/Over the 120-character limit/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const counter = message.closest("[id]");
    expect(counter && describedBy.split(" ")).toContain(counter?.id);
  });
});

describe("TypePickerGrid", () => {
  it("lists the ten types with name, description and scoring, and reports the pick", () => {
    const onPick = vi.fn();
    render(<TypePickerGrid onPick={onPick} />, { wrapper: Wrapper });
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(10);
    expect(screen.getByText("Type answer")).toBeTruthy();
    expect(screen.getByText("Short text checked against accepted answers.")).toBeTruthy();
    // Incremento 5: ordering and numeric score; the word cloud never does.
    expect(screen.getByText("Ordering")).toBeTruthy();
    expect(screen.getByText("Word cloud")).toBeTruthy();
    expect(screen.getAllByText("Scored")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: /Poll/ }));
    expect(onPick).toHaveBeenCalledWith("poll" satisfies LiveItemType);
  });

  it("only shows the types enabled by the server", () => {
    render(<TypePickerGrid onPick={vi.fn()} types={["single_choice", "content"]} />, { wrapper: Wrapper });
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
