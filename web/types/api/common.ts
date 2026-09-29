/** Shared primitives: error envelopes, health, message codes, options and references. */

export interface ApiFieldError {
  /** Dotted field path without the "body"/"query" prefix, e.g. "options.0.text". */
  field: string;
  message: string;
  type?: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: string;
  status?: number;
  fieldErrors?: ApiFieldError[];
  retryAfterSeconds?: number | null;
  requestId?: string | null;
}

/** Error envelope returned by the backend (contract §1). */
export interface ApiErrorEnvelope {
  detail: string;
  code: string;
  message?: string;
  errors?: Array<{ loc: Array<string | number>; msg: string; type: string }>;
  details?: Record<string, unknown>;
  request_id?: string;
}

export interface HealthResponse {
  ok: boolean;
  ai_enabled: boolean;
  ai_model: string | null;
}

/** Stable i18n code + interpolation params for a backend message (M-C7). */
export interface MessageCode {
  code: string;
  params: Record<string, string | number | null>;
}

export interface OptionItem {
  key: string;
  text: string;
}

export interface CitationItem {
  source?: string;
  reference?: string;
  material_path?: string;
  locator?: string;
  page_start?: number | string | null;
  page_end?: number | string | null;
  [key: string]: unknown;
}

export interface PedagogicalReferenceItem {
  source_kind: string;
  label: string;
  reference?: string | null;
  material_path?: string | null;
  locator?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  is_official: boolean;
}
