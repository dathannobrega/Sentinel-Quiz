// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { NumericEditor } from "@/features/quiz-builder/components/editor/numeric-editor";
import { OrderingEditor } from "@/features/quiz-builder/components/editor/ordering-editor";
import { I18nProvider } from "@/lib/i18n/provider";
import type { AppLocale } from "@/lib/i18n/core";
import type { LiveItemOption, LiveOrderMethod } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/quizzes/q1/edit"
}));

afterEach(() => cleanup());

function wrap(node: ReactNode, locale: AppLocale = "en-US") {
  return (
    <I18nProvider locale={locale} localeFromCookie>
      {node}
    </I18nProvider>
  );
}

const ITEMS: LiveItemOption[] = ["Preparation", "Detection", "Containment"].map((text, index) => ({ key: "ABC"[index] as string, text, correct: false }));

function Ordering({ onChange }: { onChange: (options: LiveItemOption[]) => void }) {
  const [options, setOptions] = useState(ITEMS);
  const [method, setMethod] = useState<LiveOrderMethod>("kendall");
  return (
    <OrderingEditor
      options={options}
      method={method}
      onChange={(next) => {
        setOptions(next);
        onChange(next);
      }}
      onMethodChange={setMethod}
    />
  );
}

describe("OrderingEditor", () => {
  it("reorders with the up/down buttons (the list is the answer key) and keeps 3 to 6 items", () => {
    const onChange = vi.fn();
    render(wrap(<Ordering onChange={onChange} />));
    expect(screen.getByText(/Participants get them shuffled/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move “Containment” up" }));
    expect(onChange.mock.lastCall?.[0].map((option: LiveItemOption) => option.text)).toEqual(["Preparation", "Containment", "Detection"]);
    expect(screen.getByText("“Containment” is now in position 2 of 3.")).toBeTruthy();
    // At the minimum, items cannot be removed.
    expect((screen.getByRole("button", { name: "Remove “Preparation”" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(onChange.mock.lastCall?.[0]).toHaveLength(4);
    expect((screen.getByRole("button", { name: "Remove “Preparation”" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /Exact/ }));
    expect((screen.getByRole("radio", { name: /Exact/ }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("NumericEditor", () => {
  const numeric = { min: 0, max: 100, step: 1, unit: "bits", value: null, tolerance: 0, partial: true };

  it("reads pt-BR numbers and saves JSON numbers", () => {
    const onPatch = vi.fn();
    render(wrap(<NumericEditor numeric={numeric} onPatch={onPatch} />, "pt-BR"));
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "1.234,5" } });
    expect(onPatch).toHaveBeenLastCalledWith({ max: 1234.5 });
    fireEvent.change(screen.getByLabelText("Valor correto"), { target: { value: "256" } });
    expect(onPatch).toHaveBeenLastCalledWith({ value: 256 });
    fireEvent.change(screen.getByLabelText("Passo"), { target: { value: "" } });
    expect(onPatch).toHaveBeenLastCalledWith({ step: null });
  });

  it("flags invalid numbers and a negative tolerance without saving them", () => {
    const onPatch = vi.fn();
    render(wrap(<NumericEditor numeric={numeric} onPatch={onPatch} />));
    fireEvent.change(screen.getByLabelText("Minimum"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Tolerance (±)"), { target: { value: "-1" } });
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getAllByText("Invalid number.")).toHaveLength(2);
    expect(screen.getByLabelText("Minimum").getAttribute("aria-invalid")).toBe("true");
  });

  it("shows server-side style issues inline (value outside the range)", () => {
    render(wrap(<NumericEditor numeric={{ ...numeric, value: 500 }} onPatch={vi.fn()} issues={[{ code: "numeric_value_out_of_range", field: "value", severity: "error" }]} />));
    expect(screen.getByText("The correct value must be inside the range.")).toBeTruthy();
  });
});
