/**
 * Performance-Based Questions (contract r5 §A).
 *
 * The served payload is the authoring format minus solution/explanation/scoring. Several fields
 * accept both the contract spelling and the authoring spelling (e.g. exhibit `type` vs `kind`,
 * log `lines` vs `rows`, table cell `input_type` vs `input`): the renderer normalizes them, so
 * every field is optional-safe.
 */

export type QuestionFormat = "mcq" | "pbq";

export type PbqTaskType = "ordering" | "categorization" | "matching" | "table_form" | "select_in_exhibit";

export type PbqExhibitType = "log" | "table" | "text";

export interface PbqTextItem {
  id: string;
  text: string;
}

export interface PbqBucket {
  id: string;
  label: string;
}

/** Table exhibit row: `cells` follow the exhibit `columns` order. */
export interface PbqExhibitTableRow {
  id: string;
  cells?: string[];
  /** Log exhibits in the authoring format use `rows: [{id, text}]`. */
  text?: string;
}

export interface PbqExhibit {
  id: string;
  type?: PbqExhibitType | (string & {});
  /** Authoring-format alias of `type`. */
  kind?: PbqExhibitType | (string & {});
  title?: string | null;
  /** text exhibits */
  content?: string | null;
  /** log exhibits */
  lines?: PbqTextItem[];
  /** table exhibits (plain labels or {id,label}) */
  columns?: Array<string | { id?: string; label: string }>;
  rows?: PbqExhibitTableRow[];
}

interface PbqTaskBase {
  id: string;
  prompt: string;
  weight?: number | null;
}

export interface PbqOrderingTask extends PbqTaskBase {
  type: "ordering";
  /** Shuffled per session by the backend. */
  items: PbqTextItem[];
}

export interface PbqCategorizationTask extends PbqTaskBase {
  type: "categorization";
  items: PbqTextItem[];
  buckets: PbqBucket[];
}

export interface PbqMatchingTask extends PbqTaskBase {
  type: "matching";
  left: PbqTextItem[];
  right: PbqTextItem[];
  /** When false, each right-hand item can be paired with at most one left item. */
  allow_reuse?: boolean | null;
}

export type PbqCellInputType = "select" | "text" | "number" | (string & {});

export interface PbqTableColumn {
  id: string;
  label: string;
  input_type?: PbqCellInputType | null;
  /** Authoring-format alias of `input_type` (may be "number_or_select"). */
  input?: PbqCellInputType | null;
  choices?: string[] | null;
  /** True when every row carries its own `choices`. */
  choices_by_row?: boolean | null;
}

export interface PbqTableCell {
  /** Fixed (read-only) value. */
  value?: string | number | null;
  editable?: boolean | null;
  input_type?: PbqCellInputType | null;
  input?: PbqCellInputType | null;
  choices?: string[] | null;
}

export interface PbqTableRow {
  id: string;
  label?: string | null;
  cells: Record<string, PbqTableCell | null | undefined>;
}

export interface PbqTableFormTask extends PbqTaskBase {
  type: "table_form";
  columns: PbqTableColumn[];
  rows: PbqTableRow[];
}

export interface PbqSelectInExhibitTask extends PbqTaskBase {
  type: "select_in_exhibit";
  exhibit_id: string;
  select_mode?: "single" | "multiple" | null;
}

export type PbqTask = PbqOrderingTask | PbqCategorizationTask | PbqMatchingTask | PbqTableFormTask | PbqSelectInExhibitTask;

/** `question.pbq` when `question.format === "pbq"` (then `options` is empty). */
export interface PbqPayload {
  title: string;
  scenario?: string | null;
  exhibits?: PbqExhibit[] | null;
  tasks: PbqTask[];
}

// ------------------------------------------------------------------ responses

/** ordering: item ids in the chosen order. */
export type PbqOrderingResponse = string[];
/** categorization: {item_id: bucket_id}. */
export type PbqCategorizationResponse = Record<string, string>;
/** matching: {left_id: right_id}. */
export type PbqMatchingResponse = Record<string, string>;
/** table_form: {row_id: {column_id: value}} (numbers sent as numbers). */
export type PbqTableFormResponse = Record<string, Record<string, string | number>>;
/** select_in_exhibit: selected line/row ids. */
export type PbqSelectInExhibitResponse = string[];

export type PbqTaskResponse =
  PbqOrderingResponse | PbqCategorizationResponse | PbqMatchingResponse | PbqTableFormResponse | PbqSelectInExhibitResponse;

/** Body field `pbq_response` of the existing answer routes: {<task_id>: response}. */
export type PbqResponse = Record<string, PbqTaskResponse>;

// ------------------------------------------------------------------ feedback

export interface PbqTaskResult {
  task_id: string;
  score: number;
  is_correct: boolean;
  points_earned?: number | null;
  points_possible?: number | null;
}

/** Accepted answers of one table cell (authoring format) or a plain value. */
export type PbqCellSolution = { accepted?: string[] | null; number?: number | null; tolerance?: number | null } | string | number;

/**
 * Solution of one task. The authoring format wraps it ({order}, {assignment}, {pairs}, {cells},
 * {selected}); a response-shaped value is accepted too.
 */
export type PbqTaskSolution =
  | {
      order?: string[];
      assignment?: Record<string, string>;
      pairs?: Record<string, string>;
      selected?: string[];
      cells?: Record<string, Record<string, PbqCellSolution>>;
    }
  | string[]
  | Record<string, unknown>;

/** Explanation of one task: plain text or {summary, per_item}. */
export type PbqTaskExplanation = string | { summary?: string | null; per_item?: Record<string, string> | null };

/** PBQ fields of the answer feedback (absent for MCQ). */
export interface PbqFeedbackFields {
  format?: QuestionFormat | (string & {});
  /** 0..1 */
  score?: number | null;
  points_earned?: number | null;
  points_possible?: number | null;
  task_results?: PbqTaskResult[] | null;
  /** Withheld in exam_day until the session is finished. */
  pbq_solution?: Record<string, PbqTaskSolution> | null;
  pbq_explanations?: Record<string, PbqTaskExplanation> | null;
}
