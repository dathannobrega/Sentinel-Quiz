// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { PbqQuestion } from "@/features/session-runner/components/pbq/pbq-question";
import {
  CATEGORIZATION_PAYLOAD,
  MATCHING_PAYLOAD,
  ORDERING_FEEDBACK,
  ORDERING_PAYLOAD,
  SELECT_IN_EXHIBIT_PAYLOAD,
  TABLE_FORM_PAYLOAD
} from "@/features/session-runner/lib/pbq-test-fixtures";
import { serializePbqResponse, type PbqResultData } from "@/features/session-runner/lib/pbq-utils";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import type { PbqPayload, PbqResponse } from "@/types/api";

const { t } = createTranslator(getMessages("en-US"));

afterEach(() => cleanup());

/** Controlled harness mirroring the runner: keeps the response and reports every change. */
function Harness({
  payload,
  initial = null,
  onResponse,
  disabled = false,
  result = null
}: {
  payload: PbqPayload;
  initial?: PbqResponse | null;
  onResponse?: (response: PbqResponse) => void;
  disabled?: boolean;
  result?: PbqResultData | null;
}) {
  const [response, setResponse] = useState<PbqResponse | null>(initial);
  return (
    <PbqQuestion
      payload={payload}
      response={response}
      disabled={disabled}
      result={result}
      onChange={(next) => {
        onResponse?.(next);
        setResponse(next);
      }}
      t={t}
    />
  );
}

function liveRegion(): HTMLElement {
  const regions = screen.getAllByRole("status");
  return regions[regions.length - 1];
}

function orderedTexts(): string[] {
  const list = screen.getByRole("list", { name: new RegExp(t("pbq.taskHeading", { current: 1, total: 1 })) });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector("[data-pbq-item-text]")?.textContent ?? "");
}

describe("PbqQuestion: scenario and exhibits", () => {
  it("renders title, scenario and every exhibit kind", () => {
    render(<Harness payload={SELECT_IN_EXHIBIT_PAYLOAD} />);
    expect(screen.getByRole("heading", { name: /Investigação de auth.log/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: t("pbq.scenario") }).textContent).toContain("Analise o trecho do log.");
    const log = screen.getByTestId("pbq-exhibit-e1");
    expect(log.querySelectorAll("code")).toHaveLength(3);
    const table = screen.getByTestId("pbq-exhibit-e2");
    expect(within(table).getByRole("columnheader", { name: "Origem" })).toBeTruthy();
    expect(within(table).getByRole("cell", { name: "10.10.50.14" })).toBeTruthy();
    expect(screen.getByTestId("pbq-exhibit-e3").textContent).toContain("R1. Somente HTTPS.");
  });
});

describe("ordering task", () => {
  it("moves items with the Up/Down buttons, announces and keeps focus", () => {
    const onResponse = vi.fn();
    render(<Harness payload={ORDERING_PAYLOAD} onResponse={onResponse} />);
    expect(orderedTexts()).toEqual(["Contenção", "Preparação", "Detecção"]);

    const down = screen.getByRole("button", { name: t("pbq.ordering.moveDown", { item: "Contenção" }) });
    // First item cannot move up; last cannot move down.
    expect((screen.getByRole("button", { name: t("pbq.ordering.moveUp", { item: "Contenção" }) }) as HTMLButtonElement).disabled).toBe(true);
    down.focus();
    fireEvent.click(down);

    expect(orderedTexts()).toEqual(["Preparação", "Contenção", "Detecção"]);
    expect(onResponse).toHaveBeenLastCalledWith({ t1: ["p", "c", "d"] });
    expect(liveRegion().textContent).toBe(t("pbq.ordering.moved", { item: "Contenção", position: 2, total: 3 }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t("pbq.ordering.moveDown", { item: "Contenção" }) }));

    fireEvent.click(screen.getByRole("button", { name: t("pbq.ordering.moveDown", { item: "Contenção" }) }));
    expect(orderedTexts()).toEqual(["Preparação", "Detecção", "Contenção"]);
    // At the bottom the Down button is disabled: focus falls back to Up for the same item.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t("pbq.ordering.moveUp", { item: "Contenção" }) }));
  });

  it("supports Alt+Arrow keys on the item buttons", () => {
    const onResponse = vi.fn();
    render(<Harness payload={ORDERING_PAYLOAD} onResponse={onResponse} />);
    const up = screen.getByRole("button", { name: t("pbq.ordering.moveUp", { item: "Detecção" }) });
    fireEvent.keyDown(up, { key: "ArrowUp", altKey: true });
    expect(onResponse).toHaveBeenLastCalledWith({ t1: ["c", "d", "p"] });
    // Plain arrows do nothing (no hijacking of normal navigation).
    fireEvent.keyDown(up, { key: "ArrowUp" });
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it("supports native drag and drop", () => {
    const onResponse = vi.fn();
    render(<Harness payload={ORDERING_PAYLOAD} onResponse={onResponse} />);
    const source = screen.getByTestId("pbq-order-item-d");
    const target = screen.getByTestId("pbq-order-item-c");
    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    expect(onResponse).toHaveBeenLastCalledWith({ t1: ["d", "c", "p"] });
  });

  it("renders no move controls when locked", () => {
    render(<Harness payload={ORDERING_PAYLOAD} disabled />);
    expect(screen.queryByRole("button", { name: /Up: move/ })).toBeNull();
    expect(screen.getByTestId("pbq-order-item-c").getAttribute("draggable")).toBe("false");
  });
});

describe("categorization task", () => {
  it("assigns via the per-item select (keyboard alternative) and announces", () => {
    const onResponse = vi.fn();
    render(<Harness payload={CATEGORIZATION_PAYLOAD} onResponse={onResponse} />);
    const select = screen.getByLabelText(t("pbq.categorization.selectLabel", { item: "Bloqueio de conta" }));
    fireEvent.change(select, { target: { value: "prev" } });

    expect(onResponse).toHaveBeenLastCalledWith({ t1: { k1: "prev" } });
    expect(within(screen.getByTestId("pbq-bucket-prev")).getByText("Bloqueio de conta")).toBeTruthy();
    expect(liveRegion().textContent).toBe(t("pbq.categorization.assigned", { item: "Bloqueio de conta", bucket: "Preventivo" }));
    // Focus follows the item into its bucket.
    expect(document.activeElement).toBe(screen.getByLabelText(t("pbq.categorization.selectLabel", { item: "Bloqueio de conta" })));

    fireEvent.change(screen.getByLabelText(t("pbq.categorization.selectLabel", { item: "Bloqueio de conta" })), {
      target: { value: "" }
    });
    expect(onResponse).toHaveBeenLastCalledWith({ t1: {} });
    expect(liveRegion().textContent).toBe(t("pbq.categorization.unassignedAnnounce", { item: "Bloqueio de conta" }));
  });

  it("assigns by dragging an item onto a bucket", () => {
    const onResponse = vi.fn();
    render(<Harness payload={CATEGORIZATION_PAYLOAD} onResponse={onResponse} />);
    fireEvent.dragStart(screen.getByTestId("pbq-cat-item-k2"));
    fireEvent.dragOver(screen.getByTestId("pbq-bucket-det"));
    fireEvent.drop(screen.getByTestId("pbq-bucket-det"));
    expect(onResponse).toHaveBeenLastCalledWith({ t1: { k2: "det" } });
    expect(screen.getByText(t("pbq.tasksComplete", { complete: 0, total: 1 }))).toBeTruthy();
  });
});

describe("matching task", () => {
  it("pairs with one select per left item and enforces no reuse", () => {
    const onResponse = vi.fn();
    render(<Harness payload={MATCHING_PAYLOAD} onResponse={onResponse} />);
    const first = screen.getByLabelText(t("pbq.matching.selectLabel", { item: "' OR '1'='1" }));
    const second = screen.getByLabelText(t("pbq.matching.selectLabel", { item: "../../etc/passwd" }));
    fireEvent.change(first, { target: { value: "a_sqli" } });
    expect(onResponse).toHaveBeenLastCalledWith({ t1: { i1: "a_sqli" } });
    // The used option is labelled as in use for the other rows.
    expect(within(second).getByRole("option", { name: t("pbq.matching.inUse", { choice: "SQL injection" }) })).toBeTruthy();

    fireEvent.change(second, { target: { value: "a_sqli" } });
    expect(onResponse).toHaveBeenLastCalledWith({ t1: { i2: "a_sqli" } });
    expect(liveRegion().textContent).toContain(
      t("pbq.matching.reused", { right: "SQL injection", left: "' OR '1'='1" })
    );
    expect((first as HTMLSelectElement).value).toBe("");
  });
});

describe("table_form task", () => {
  it("renders fixed cells as text and labelled controls for editable cells", () => {
    const onResponse = vi.fn();
    render(<Harness payload={TABLE_FORM_PAYLOAD} onResponse={onResponse} />);
    const row1 = screen.getByTestId("pbq-row-r1");
    expect(within(row1).getByText("ALLOW")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(t("pbq.tableForm.cellLabel", { row: "Regra 1", column: "Origem" })), {
      target: { value: "10.10.50.0/24" }
    });
    const numberInput = screen.getByLabelText(t("pbq.tableForm.cellLabel", { row: "Regra 1", column: "Valor" })) as HTMLInputElement;
    expect(numberInput.tagName).toBe("INPUT");
    expect(numberInput.getAttribute("inputmode")).toBe("decimal");
    fireEvent.change(numberInput, { target: { value: "3000" } });
    const rowChoice = screen.getByLabelText(t("pbq.tableForm.cellLabel", { row: "Regra 2", column: "Valor" }));
    expect(rowChoice.tagName).toBe("SELECT");
    fireEvent.change(rowChoice, { target: { value: "Implementar" } });

    const last = onResponse.mock.calls.at(-1)?.[0] as PbqResponse;
    expect(last).toEqual({ t1: { r1: { src: "10.10.50.0/24", val: "3000" }, r2: { val: "Implementar" } } });
    expect(serializePbqResponse(TABLE_FORM_PAYLOAD, last)).toEqual({
      t1: { r1: { src: "10.10.50.0/24", val: 3000 }, r2: { val: "Implementar" } }
    });
  });
});

describe("select_in_exhibit task", () => {
  it("uses checkboxes for multiple and radios for single selection", () => {
    const onResponse = vi.fn();
    render(<Harness payload={SELECT_IN_EXHIBIT_PAYLOAD} onResponse={onResponse} />);
    const multiple = screen.getByRole("group", { name: t("pbq.selectInExhibit.legendMultiple", { title: "Anexo 1 - auth.log" }) });
    const boxes = within(multiple).getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    fireEvent.click(within(multiple).getByLabelText(/Accepted password for deploy/));
    fireEvent.click(within(multiple).getByLabelText(/Failed password/));
    expect(onResponse).toHaveBeenLastCalledWith({ t1: ["l02", "l01"] });
    fireEvent.click(within(multiple).getByLabelText(/Failed password/));
    expect(onResponse).toHaveBeenLastCalledWith({ t1: ["l02"] });

    const single = screen.getByRole("group", { name: t("pbq.selectInExhibit.legendSingle", { title: "Anexo 2 - Conexões" }) });
    const radios = within(single).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    fireEvent.click(radios[0]);
    fireEvent.click(radios[1]);
    expect(onResponse).toHaveBeenLastCalledWith({ t1: ["l02"], t2: ["c2"] });
  });
});

describe("feedback rendering", () => {
  it("shows per-task result, answer-key overlay and explanations, and can hide the overlay", () => {
    render(<Harness payload={ORDERING_PAYLOAD} disabled result={ORDERING_FEEDBACK} />);
    const task = screen.getByTestId("pbq-task-t1");
    expect(within(task).getByText(new RegExp(`${t("pbq.feedback.taskPartial")} · 33%`))).toBeTruthy();
    // Served order c, p, d vs solution p, d, c: every item misplaced, positions spelled out.
    expect(within(task).getByText(t("pbq.ordering.expectedPosition", { position: 3 }))).toBeTruthy();
    expect(within(task).getByText(t("pbq.ordering.correctOrder"))).toBeTruthy();
    expect(within(task).getByText("Preparação vem antes da detecção.")).toBeTruthy();
    expect(within(task).getByText("Contenção vem depois.")).toBeTruthy();

    const toggle = screen.getByRole("button", { name: t("pbq.feedback.hideSolution") });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    act(() => toggle.click());
    expect(within(task).queryByText(t("pbq.ordering.correctOrder"))).toBeNull();
    expect(within(task).queryByText("Preparação vem antes da detecção.")).toBeNull();
    // The task result itself stays visible.
    expect(within(task).getByText(new RegExp(t("pbq.feedback.taskPartial")))).toBeTruthy();
  });

  it("marks categorization, matching, table and exhibit answers against the key", () => {
    const { unmount } = render(
      <Harness
        payload={CATEGORIZATION_PAYLOAD}
        disabled
        initial={{ t1: { k1: "prev", k2: "prev" } }}
        result={{ score: 0.5, task_results: [{ task_id: "t1", score: 0.5, is_correct: false }], pbq_solution: { t1: { assignment: { k1: "prev", k2: "det" } } } }}
      />
    );
    expect(screen.getByText(t("pbq.categorization.expected", { bucket: "Detectivo" }))).toBeTruthy();
    expect(screen.getAllByText(t("pbq.marks.correct"))).toHaveLength(1);
    unmount();

    render(
      <Harness
        payload={SELECT_IN_EXHIBIT_PAYLOAD}
        disabled
        initial={{ t1: ["l01", "l02"], t2: ["c1"] }}
        result={{ score: 0.5, pbq_solution: { t1: { selected: ["l02"] }, t2: { selected: ["c2"] } } }}
      />
    );
    expect(screen.getAllByText(t("pbq.selectInExhibit.correctlySelected"))).toHaveLength(1);
    expect(screen.getAllByText(t("pbq.selectInExhibit.shouldNotSelect"))).toHaveLength(2);
    expect(screen.getAllByText(t("pbq.selectInExhibit.shouldSelect"))).toHaveLength(1);
  });

  it("hides the overlay entirely when no solution is provided (exam_day)", () => {
    render(
      <Harness
        payload={ORDERING_PAYLOAD}
        disabled
        result={{ score: null, pbq_solution: null, pbq_explanations: null, task_results: null }}
      />
    );
    expect(screen.queryByRole("button", { name: t("pbq.feedback.hideSolution") })).toBeNull();
    expect(screen.queryByText(t("pbq.ordering.correctOrder"))).toBeNull();
    expect(screen.queryByText(new RegExp(t("pbq.ordering.correctPosition")))).toBeNull();
  });
});
