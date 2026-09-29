/**
 * Pure helpers for Performance-Based Questions (contract r5 §A): payload normalization (the
 * served payload may use the contract or the authoring spelling), default/serialized responses,
 * solution normalization and client-side per-item marks used only for display.
 */
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import type {
  PbqCellSolution,
  PbqFeedbackFields,
  PbqExhibit,
  PbqPayload,
  PbqResponse,
  PbqTableCell,
  PbqTableColumn,
  PbqTableFormResponse,
  PbqTask,
  PbqTaskExplanation,
  PbqTaskResponse,
  PbqTaskResult,
  PbqTaskSolution,
  PbqTextItem,
  QuestionItem
} from "@/types/api";

export const PBQ_MAX_COUNT = 5;

export function isPbqQuestion(question: Pick<QuestionItem, "format" | "pbq"> | null | undefined): question is QuestionItem & {
  pbq: PbqPayload;
} {
  if (!question || !question.pbq || !Array.isArray(question.pbq.tasks)) {
    return false;
  }
  // `format` is the contract flag; a payload without it is still treated as a PBQ unless "mcq".
  return question.format === "pbq" || question.format === undefined || question.format === null;
}

/**
 * The saved PBQ response of a runtime/review question: `pbq_response` (contract), with fallbacks
 * for `response` / `response_json` (object or JSON string). null when absent or malformed.
 */
export function extractPbqResponse(question: object | null | undefined): PbqResponse | null {
  if (!question) {
    return null;
  }
  const record = question as Record<string, unknown>;
  for (const key of ["pbq_response", "response", "response_json"]) {
    let value = record[key];
    if (typeof value === "string") {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        continue;
      }
    }
    if (isRecord(value)) {
      return value as PbqResponse;
    }
  }
  return null;
}

/** Clamp a launcher value to the 0–5 range accepted by the API. */
export function clampPbqCount(value: unknown): number {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.min(number, PBQ_MAX_COUNT);
}

// ------------------------------------------------------------------ exhibits

export interface NormalizedExhibit {
  id: string;
  type: "log" | "table" | "text";
  title: string;
  content: string;
  lines: PbqTextItem[];
  columns: string[];
  rows: Array<{ id: string; cells: string[] }>;
}

export function normalizeExhibit(exhibit: PbqExhibit): NormalizedExhibit {
  const rawType = String(exhibit.type || exhibit.kind || "").toLowerCase();
  const rows = Array.isArray(exhibit.rows) ? exhibit.rows : [];
  const logRows = rows.filter((row) => typeof row.text === "string").map((row) => ({ id: row.id, text: row.text as string }));
  const lines = Array.isArray(exhibit.lines) && exhibit.lines.length ? exhibit.lines : logRows;
  const columns = (Array.isArray(exhibit.columns) ? exhibit.columns : []).map((column) =>
    typeof column === "string" ? column : column.label
  );
  let type: NormalizedExhibit["type"];
  if (rawType === "log" || rawType === "table" || rawType === "text") {
    type = rawType;
  } else if (lines.length) {
    type = "log";
  } else if (columns.length) {
    type = "table";
  } else {
    type = "text";
  }
  return {
    id: exhibit.id,
    type,
    title: exhibit.title || "",
    content: typeof exhibit.content === "string" ? exhibit.content : "",
    lines,
    columns,
    rows: rows
      .filter((row) => Array.isArray(row.cells))
      .map((row) => ({
        id: row.id,
        cells: (row.cells as unknown[]).map((cell) => String(cell ?? ""))
      }))
  };
}

/** Lines a select_in_exhibit task can pick: log lines, or table rows rendered as text. */
export function selectableExhibitLines(exhibit: NormalizedExhibit | null): PbqTextItem[] {
  if (!exhibit) {
    return [];
  }
  if (exhibit.type === "table") {
    return exhibit.rows.map((row) => ({
      id: row.id,
      text: row.cells.map((cell, index) => (exhibit.columns[index] ? `${exhibit.columns[index]}: ${cell}` : cell)).join(" · ")
    }));
  }
  return exhibit.lines;
}

// ------------------------------------------------------------------ table_form cells

export type CellInputKind = "select" | "number" | "text";

export function isEditableCell(cell: PbqTableCell | null | undefined): boolean {
  return !!cell && cell.editable === true;
}

export function cellChoices(column: PbqTableColumn, cell: PbqTableCell | null | undefined): string[] {
  const own = cell?.choices;
  if (Array.isArray(own) && own.length) {
    return own.map(String);
  }
  return Array.isArray(column.choices) ? column.choices.map(String) : [];
}

export function cellInputKind(column: PbqTableColumn, cell: PbqTableCell | null | undefined): CellInputKind {
  const raw = String(cell?.input_type || cell?.input || column.input_type || column.input || "").toLowerCase();
  if (raw === "number") {
    return "number";
  }
  if (raw === "text") {
    return "text";
  }
  if (raw === "select") {
    return "select";
  }
  // Unknown or "number_or_select": decide from the available choices.
  return cellChoices(column, cell).length ? "select" : raw.includes("number") ? "number" : "text";
}

// ------------------------------------------------------------------ responses

export function defaultTaskResponse(task: PbqTask): PbqTaskResponse {
  switch (task.type) {
    case "ordering":
      return (task.items ?? []).map((item) => item.id);
    case "select_in_exhibit":
      return [];
    default:
      return {};
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Response value of one task, falling back to the task default when absent or malformed. */
export function taskResponse(task: PbqTask, response: PbqResponse | null | undefined): PbqTaskResponse {
  const value = response?.[task.id];
  if (task.type === "ordering") {
    const ids = (task.items ?? []).map((item) => item.id);
    if (isStringArray(value) && value.length === ids.length && ids.every((id) => value.includes(id))) {
      return value;
    }
    return ids;
  }
  if (task.type === "select_in_exhibit") {
    return isStringArray(value) ? value : [];
  }
  return isRecord(value) ? (value as PbqTaskResponse) : {};
}

/** Full response for every task (ordering tasks always carry their current order). */
export function buildPbqResponse(payload: PbqPayload, response: PbqResponse | null | undefined): PbqResponse {
  const result: PbqResponse = {};
  for (const task of payload.tasks) {
    result[task.id] = taskResponse(task, response);
  }
  return result;
}

/** Parses a numeric cell typed by the user ("30000", "30.000,5", "3,5"). null when not a number. */
export function parseNumericCell(value: string): number | null {
  const raw = value.trim().replace(/\s/g, "");
  if (!raw) {
    return null;
  }
  let normalized = raw;
  if (raw.includes(",")) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, "");
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

/** Body value of `pbq_response`: empty cells dropped, numeric cells sent as numbers. */
export function serializePbqResponse(payload: PbqPayload, response: PbqResponse | null | undefined): PbqResponse {
  const full = buildPbqResponse(payload, response);
  for (const task of payload.tasks) {
    if (task.type !== "table_form") {
      continue;
    }
    const value = full[task.id] as PbqTableFormResponse;
    const serialized: PbqTableFormResponse = {};
    for (const row of task.rows ?? []) {
      const rowValues = value[row.id];
      if (!rowValues) {
        continue;
      }
      for (const column of task.columns ?? []) {
        const cell = row.cells?.[column.id];
        const raw = rowValues[column.id];
        if (!isEditableCell(cell) || raw === undefined || String(raw).trim() === "") {
          continue;
        }
        const kind = cellInputKind(column, cell);
        const parsed = kind === "number" ? parseNumericCell(String(raw)) : null;
        serialized[row.id] = {
          ...(serialized[row.id] ?? {}),
          [column.id]: parsed ?? String(raw)
        };
      }
    }
    full[task.id] = serialized;
  }
  return full;
}

/** A task is complete when every item/row/cell has an answer (ordering is always complete). */
export function isTaskComplete(task: PbqTask, value: PbqTaskResponse): boolean {
  switch (task.type) {
    case "ordering":
      return true;
    case "categorization": {
      const map = value as Record<string, string>;
      return (task.items ?? []).every((item) => !!map[item.id]);
    }
    case "matching": {
      const map = value as Record<string, string>;
      return (task.left ?? []).every((item) => !!map[item.id]);
    }
    case "table_form": {
      const map = value as PbqTableFormResponse;
      return (task.rows ?? []).every((row) =>
        (task.columns ?? []).every((column) => {
          if (!isEditableCell(row.cells?.[column.id])) {
            return true;
          }
          const cellValue = map[row.id]?.[column.id];
          return cellValue !== undefined && String(cellValue).trim() !== "";
        })
      );
    }
    case "select_in_exhibit":
      return (value as string[]).length > 0;
    default:
      return false;
  }
}

export function countCompleteTasks(payload: PbqPayload, response: PbqResponse | null | undefined): number {
  return payload.tasks.filter((task) => isTaskComplete(task, taskResponse(task, response))).length;
}

// ------------------------------------------------------------------ solutions

export type NormalizedSolution =
  | { type: "ordering"; order: string[] }
  | { type: "categorization" | "matching"; map: Record<string, string> }
  | { type: "select_in_exhibit"; selected: string[] }
  | {
      type: "table_form";
      cells: Record<string, Record<string, NormalizedCellSolution>>;
    };

export interface NormalizedCellSolution {
  accepted: string[];
  number: number | null;
  tolerance: number;
}

function normalizeCellSolution(raw: PbqCellSolution | unknown): NormalizedCellSolution | null {
  if (typeof raw === "string") {
    return { accepted: [raw], number: null, tolerance: 0 };
  }
  if (typeof raw === "number") {
    return { accepted: [], number: raw, tolerance: 0 };
  }
  if (!isRecord(raw)) {
    return null;
  }
  const accepted = isStringArray(raw.accepted) ? raw.accepted : [];
  const number = typeof raw.number === "number" ? raw.number : null;
  const tolerance = typeof raw.tolerance === "number" ? Math.abs(raw.tolerance) : 0;
  if (!accepted.length && number === null) {
    return null;
  }
  return { accepted, number, tolerance };
}

function stringMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      result[key] = item;
    }
  }
  return result;
}

export function normalizeSolution(task: PbqTask, raw: PbqTaskSolution | null | undefined): NormalizedSolution | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const record = isRecord(raw) ? raw : null;
  switch (task.type) {
    case "ordering": {
      const order = isStringArray(record?.order) ? record.order : isStringArray(raw) ? raw : null;
      return order ? { type: "ordering", order } : null;
    }
    case "categorization":
    case "matching": {
      const wrapped = task.type === "categorization" ? record?.assignment : record?.pairs;
      const map = stringMap(wrapped) ?? stringMap(raw);
      return map ? { type: task.type, map } : null;
    }
    case "select_in_exhibit": {
      const selected = isStringArray(record?.selected) ? record.selected : isStringArray(raw) ? raw : null;
      return selected ? { type: "select_in_exhibit", selected } : null;
    }
    case "table_form": {
      const source = isRecord(record?.cells) ? record.cells : record;
      if (!source) {
        return null;
      }
      const cells: Record<string, Record<string, NormalizedCellSolution>> = {};
      for (const [rowId, rowValue] of Object.entries(source)) {
        if (!isRecord(rowValue)) {
          continue;
        }
        for (const [columnId, cellValue] of Object.entries(rowValue)) {
          const normalized = normalizeCellSolution(cellValue);
          if (normalized) {
            cells[rowId] = { ...(cells[rowId] ?? {}), [columnId]: normalized };
          }
        }
      }
      return { type: "table_form", cells };
    }
    default:
      return null;
  }
}

/** Display text of the accepted answer(s) of one cell. */
export function formatCellSolution(solution: NormalizedCellSolution): string {
  const parts = [...solution.accepted];
  if (solution.number !== null) {
    parts.push(solution.tolerance ? `${solution.number} ± ${solution.tolerance}` : String(solution.number));
  }
  return parts.join(" / ");
}

/** Client-side check used only to mark cells in the solution overlay. */
export function isCellValueAccepted(solution: NormalizedCellSolution, value: string | number | undefined): boolean {
  if (value === undefined || String(value).trim() === "") {
    return false;
  }
  const text = String(value).trim().toLowerCase();
  if (solution.accepted.some((accepted) => accepted.trim().toLowerCase() === text)) {
    return true;
  }
  if (solution.number !== null) {
    const parsed = typeof value === "number" ? value : parseNumericCell(String(value));
    return parsed !== null && Math.abs(parsed - solution.number) <= solution.tolerance;
  }
  return false;
}

// ------------------------------------------------------------------ explanations / results

export interface NormalizedExplanation {
  summary: string;
  perItem: Record<string, string>;
}

export function normalizeExplanation(raw: PbqTaskExplanation | null | undefined): NormalizedExplanation | null {
  if (typeof raw === "string") {
    return raw.trim() ? { summary: raw.trim(), perItem: {} } : null;
  }
  if (!isRecord(raw)) {
    return null;
  }
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const perItem = stringMap(raw.per_item) ?? {};
  if (!summary && !Object.keys(perItem).length) {
    return null;
  }
  return { summary, perItem };
}

export function findTaskResult(results: PbqTaskResult[] | null | undefined, taskId: string): PbqTaskResult | null {
  return (results ?? []).find((result) => result.task_id === taskId) ?? null;
}

/** 0..1 score → integer percent (clamped). */
export function scoreToPercent(score: number | null | undefined): number | null {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return null;
  }
  return Math.round(Math.min(Math.max(score, 0), 1) * 100);
}

/** Moves `id` to `targetIndex` in `order` (clamped). Returns a new array. */
export function moveItem(order: string[], id: string, targetIndex: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) {
    return order;
  }
  const next = order.filter((item) => item !== id);
  const index = Math.min(Math.max(targetIndex, 0), next.length);
  next.splice(index, 0, id);
  return next;
}

// ------------------------------------------------------------------ result labels

export type PbqResultData = Pick<
  PbqFeedbackFields,
  "score" | "points_earned" | "points_possible" | "task_results" | "pbq_solution" | "pbq_explanations"
>;

/** Score line for a graded PBQ ("Pontuação: 67% · 2 de 3 pontos"). null when ungraded. */
export function formatPbqScoreLine(result: PbqResultData | null | undefined, t: Translate): string | null {
  const percent = scoreToPercent(result?.score);
  if (percent === null) {
    return null;
  }
  const parts = [t("pbq.feedback.score", { percent })];
  if (typeof result?.points_earned === "number" && typeof result?.points_possible === "number") {
    parts.push(
      t("pbq.feedback.points", {
        earned: formatPoints(result.points_earned),
        possible: formatPoints(result.points_possible)
      })
    );
  }
  return parts.join(" · ");
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Overall credit label: full / partial / none. */
export function pbqCreditLabel(score: number | null | undefined, t: Translate): string {
  const percent = scoreToPercent(score) ?? 0;
  if (percent >= 100) {
    return t("pbq.feedback.fullCredit");
  }
  return percent > 0 ? t("pbq.feedback.partialCredit") : t("pbq.feedback.noCredit");
}

export function pbqAnnouncement(result: PbqResultData, t: Translate): string {
  return t("pbq.feedback.announce", {
    percent: scoreToPercent(result.score) ?? 0,
    earned: formatPoints(result.points_earned ?? 0),
    possible: formatPoints(result.points_possible ?? 0)
  });
}
