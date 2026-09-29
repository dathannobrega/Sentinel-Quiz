import { describe, expect, it } from "vitest";

import {
  buildPbqResponse,
  clampPbqCount,
  countCompleteTasks,
  formatCellSolution,
  formatPbqScoreLine,
  isCellValueAccepted,
  isPbqQuestion,
  moveItem,
  normalizeExhibit,
  normalizeExplanation,
  normalizeSolution,
  parseNumericCell,
  pbqCreditLabel,
  scoreToPercent,
  selectableExhibitLines,
  serializePbqResponse
} from "@/features/session-runner/lib/pbq-utils";
import {
  CATEGORIZATION_PAYLOAD,
  ORDERING_PAYLOAD,
  SELECT_IN_EXHIBIT_PAYLOAD,
  TABLE_FORM_PAYLOAD
} from "@/features/session-runner/lib/pbq-test-fixtures";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import type { PbqTask } from "@/types/api";

const { t } = createTranslator(getMessages("en-US"));

describe("pbq-utils", () => {
  it("detects PBQs only with format pbq and a payload", () => {
    expect(isPbqQuestion({ format: "pbq", pbq: ORDERING_PAYLOAD })).toBe(true);
    expect(isPbqQuestion({ format: "pbq", pbq: null })).toBe(false);
    expect(isPbqQuestion({ format: "mcq" })).toBe(false);
    expect(isPbqQuestion({})).toBe(false);
    expect(isPbqQuestion(null)).toBe(false);
  });

  it("clamps the launcher count to 0–5", () => {
    expect(clampPbqCount(3)).toBe(3);
    expect(clampPbqCount(9)).toBe(5);
    expect(clampPbqCount(-1)).toBe(0);
    expect(clampPbqCount("2")).toBe(2);
    expect(clampPbqCount(undefined)).toBe(0);
    expect(clampPbqCount("abc")).toBe(0);
  });

  it("normalizes exhibits in the contract and the authoring spelling", () => {
    const [log, table, text] = (SELECT_IN_EXHIBIT_PAYLOAD.exhibits ?? []).map(normalizeExhibit);
    expect(log.type).toBe("log");
    expect(log.lines.map((line) => line.id)).toEqual(["l01", "l02", "l03"]);
    expect(table.type).toBe("table");
    expect(table.rows[1]).toEqual({ id: "c2", cells: ["2", "10.10.50.14"] });
    expect(selectableExhibitLines(table)[0]).toEqual({ id: "c1", text: "#: 1 · Origem: 203.0.113.7" });
    expect(text.type).toBe("text");
    expect(text.content).toContain("HTTPS");
    // Contract spelling: type + lines.
    const contractLog = normalizeExhibit({ id: "x", type: "log", lines: [{ id: "a", text: "line" }] });
    expect(selectableExhibitLines(contractLog)).toEqual([{ id: "a", text: "line" }]);
    // No type at all: inferred.
    expect(normalizeExhibit({ id: "y", columns: ["a"], rows: [] }).type).toBe("table");
  });

  it("fills defaults: ordering keeps the served order, others start empty", () => {
    const full = buildPbqResponse(ORDERING_PAYLOAD, null);
    expect(full).toEqual({ t1: ["c", "p", "d"] });
    // A malformed saved ordering (missing ids) falls back to the served order.
    expect(buildPbqResponse(ORDERING_PAYLOAD, { t1: ["p"] })).toEqual({ t1: ["c", "p", "d"] });
    expect(buildPbqResponse(CATEGORIZATION_PAYLOAD, { t1: { k1: "prev" } })).toEqual({ t1: { k1: "prev" } });
    expect(buildPbqResponse(SELECT_IN_EXHIBIT_PAYLOAD, {})).toEqual({ t1: [], t2: [] });
  });

  it("serializes table_form: drops empty and fixed cells, numbers as numbers", () => {
    const body = serializePbqResponse(TABLE_FORM_PAYLOAD, {
      t1: {
        r1: { src: "10.10.50.0/24", val: "30.000", act: "DENY" },
        r2: { act: "", val: "Implementar" }
      }
    });
    expect(body).toEqual({ t1: { r1: { src: "10.10.50.0/24", val: 30000 }, r2: { val: "Implementar" } } });
  });

  it("parses numeric cells in pt-BR and en formats", () => {
    expect(parseNumericCell("30000")).toBe(30000);
    expect(parseNumericCell("30.000")).toBe(30000);
    expect(parseNumericCell("3,5")).toBe(3.5);
    expect(parseNumericCell("1.234,5")).toBe(1234.5);
    expect(parseNumericCell("2.5")).toBe(2.5);
    expect(parseNumericCell("abc")).toBeNull();
    expect(parseNumericCell(" ")).toBeNull();
  });

  it("counts complete tasks", () => {
    expect(countCompleteTasks(CATEGORIZATION_PAYLOAD, { t1: { k1: "prev" } })).toBe(0);
    expect(countCompleteTasks(CATEGORIZATION_PAYLOAD, { t1: { k1: "prev", k2: "det" } })).toBe(1);
    expect(countCompleteTasks(ORDERING_PAYLOAD, null)).toBe(1);
    expect(countCompleteTasks(SELECT_IN_EXHIBIT_PAYLOAD, { t1: ["l02"] })).toBe(1);
  });

  it("normalizes wrapped (authoring) and response-shaped solutions", () => {
    const [ordering] = ORDERING_PAYLOAD.tasks as PbqTask[];
    expect(normalizeSolution(ordering, { order: ["p", "d", "c"] })).toEqual({ type: "ordering", order: ["p", "d", "c"] });
    expect(normalizeSolution(ordering, ["p", "d", "c"])).toEqual({ type: "ordering", order: ["p", "d", "c"] });
    const [categorization] = CATEGORIZATION_PAYLOAD.tasks;
    expect(normalizeSolution(categorization, { assignment: { k1: "prev" } })).toEqual({ type: "categorization", map: { k1: "prev" } });
    expect(normalizeSolution(categorization, { k1: "prev" })).toEqual({ type: "categorization", map: { k1: "prev" } });
    const [select] = SELECT_IN_EXHIBIT_PAYLOAD.tasks;
    expect(normalizeSolution(select, { selected: ["l02"] })).toEqual({ type: "select_in_exhibit", selected: ["l02"] });
    const [table] = TABLE_FORM_PAYLOAD.tasks;
    const tableSolution = normalizeSolution(table, {
      cells: { r1: { src: { accepted: ["10.10.50.0/24"] }, val: { number: 30000, tolerance: 0 } }, r2: { act: "DENY" } }
    });
    expect(tableSolution).toEqual({
      type: "table_form",
      cells: {
        r1: { src: { accepted: ["10.10.50.0/24"], number: null, tolerance: 0 }, val: { accepted: [], number: 30000, tolerance: 0 } },
        r2: { act: { accepted: ["DENY"], number: null, tolerance: 0 } }
      }
    });
    expect(normalizeSolution(ordering, null)).toBeNull();
  });

  it("checks table cells against accepted values and numeric tolerance", () => {
    const accepted = { accepted: ["TCP 443"], number: null, tolerance: 0 };
    expect(isCellValueAccepted(accepted, "tcp 443")).toBe(true);
    expect(isCellValueAccepted(accepted, "TCP 80")).toBe(false);
    expect(isCellValueAccepted(accepted, undefined)).toBe(false);
    const numeric = { accepted: [], number: 3000, tolerance: 5 };
    expect(isCellValueAccepted(numeric, "3.004")).toBe(true);
    expect(isCellValueAccepted(numeric, 3010)).toBe(false);
    expect(formatCellSolution(numeric)).toBe("3000 ± 5");
    expect(formatCellSolution(accepted)).toBe("TCP 443");
  });

  it("normalizes explanations given as text or {summary, per_item}", () => {
    expect(normalizeExplanation("Texto")).toEqual({ summary: "Texto", perItem: {} });
    expect(normalizeExplanation({ summary: "S", per_item: { a: "x" } })).toEqual({ summary: "S", perItem: { a: "x" } });
    expect(normalizeExplanation({ summary: "", per_item: {} })).toBeNull();
    expect(normalizeExplanation(undefined)).toBeNull();
  });

  it("formats score, points and credit labels", () => {
    expect(scoreToPercent(0.666)).toBe(67);
    expect(scoreToPercent(1.2)).toBe(100);
    expect(scoreToPercent(null)).toBeNull();
    expect(formatPbqScoreLine({ score: 0.5, points_earned: 1.5, points_possible: 3 }, t)).toBe(
      `${t("pbq.feedback.score", { percent: 50 })} · ${t("pbq.feedback.points", { earned: "1.5", possible: "3" })}`
    );
    expect(formatPbqScoreLine({ score: null }, t)).toBeNull();
    expect(pbqCreditLabel(1, t)).toBe(t("pbq.feedback.fullCredit"));
    expect(pbqCreditLabel(0.4, t)).toBe(t("pbq.feedback.partialCredit"));
    expect(pbqCreditLabel(0, t)).toBe(t("pbq.feedback.noCredit"));
  });

  it("moves ordering items with clamping", () => {
    expect(moveItem(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "c", -3)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], "a", 9)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });
});
