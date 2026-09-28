import { getMessages, isSupportedLocale, type AppLocale } from "@/lib/i18n/core";
import type { ApiErrorPayload, ApiFieldError } from "@/types/api";

/**
 * Normalized error thrown by every apiClient call.
 *
 * Backend contract (§1): error bodies are `{detail: string, code: string, ...}`.
 * Legacy shapes are still accepted: FastAPI 422 `detail` arrays, `detail` objects
 * (`{code, message}`), `{message}` bodies, plain text and HTML error pages.
 */
export class ApiError extends Error {
  code: string;
  details?: string;
  status: number;
  fieldErrors: ApiFieldError[];
  retryAfterSeconds: number | null;
  requestId: string | null;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.details = payload.details;
    this.status = payload.status ?? 500;
    this.fieldErrors = payload.fieldErrors ?? [];
    this.retryAfterSeconds = payload.retryAfterSeconds ?? null;
    this.requestId = payload.requestId ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

let activeLocale: AppLocale | null = null;

/** Called by the I18nProvider so that client-side error messages follow the UI locale. */
export function setApiErrorLocale(locale: AppLocale): void {
  activeLocale = locale;
}

function resolveLocale(): AppLocale {
  if (activeLocale) {
    return activeLocale;
  }
  if (typeof document !== "undefined") {
    const lang = document.documentElement.lang;
    if (isSupportedLocale(lang)) {
      return lang;
    }
  }
  return "pt-BR";
}

type ApiMessageKey = keyof ReturnType<typeof getMessages>["api"];

export function apiMessage(key: ApiMessageKey, values?: Record<string, string | number>): string {
  const template = String(getMessages(resolveLocale()).api[key] ?? key);
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    values[token] === undefined ? match : String(values[token])
  );
}

export function fallbackMessageForStatus(status: number, retryAfterSeconds: number | null = null): string {
  if (status === 400) return apiMessage("badRequest");
  if (status === 401) return apiMessage("unauthorized");
  if (status === 403) return apiMessage("forbidden");
  if (status === 404) return apiMessage("notFound");
  if (status === 408) return apiMessage("timeout");
  if (status === 409) return apiMessage("conflict");
  if (status === 413) return apiMessage("tooLarge");
  if (status === 422) return apiMessage("validation");
  if (status === 429) {
    return retryAfterSeconds ? apiMessage("rateLimitedRetry", { seconds: retryAfterSeconds }) : apiMessage("rateLimited");
  }
  if (status === 502 || status === 503 || status === 504) return apiMessage("unavailable");
  if (status >= 500) return apiMessage("server");
  return apiMessage("httpStatus", { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatLoc(loc: unknown): string {
  if (!Array.isArray(loc)) {
    return "";
  }
  return loc
    .filter((part) => part !== "body" && part !== "query" && part !== "path")
    .map((part) => String(part))
    .join(".");
}

function toFieldErrors(items: unknown): ApiFieldError[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter(isRecord)
    .map((item) => ({
      field: formatLoc(item.loc),
      message: String(item.msg ?? item.message ?? "").trim(),
      type: typeof item.type === "string" ? item.type : undefined
    }))
    .filter((item) => item.message);
}

function joinFieldErrors(errors: ApiFieldError[]): string {
  return errors
    .slice(0, 3)
    .map((item) => (item.field ? `${item.field}: ${item.message}` : item.message))
    .join("; ");
}

export function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  return null;
}

function looksLikeHtml(body: string, contentType: string): boolean {
  return contentType.includes("text/html") || /^\s*</.test(body);
}

export interface RawErrorResponse {
  status: number;
  body: string;
  contentType?: string | null;
  retryAfter?: string | null;
  requestId?: string | null;
}

/** Pure normalization of an HTTP error response. Exported for unit tests. */
export function normalizeErrorResponse(raw: RawErrorResponse): ApiError {
  const status = raw.status;
  const contentType = String(raw.contentType || "").toLowerCase();
  const retryAfterSeconds = parseRetryAfter(raw.retryAfter);
  const body = String(raw.body || "");
  let code = `http_${status}`;
  let message = "";
  let fieldErrors: ApiFieldError[] = [];
  let requestId = raw.requestId || null;

  if (body.trim()) {
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }

    if (isRecord(parsed)) {
      const detail = parsed.detail;
      if (typeof parsed.code === "string" && parsed.code.trim()) {
        code = parsed.code.trim();
      }
      if (typeof parsed.request_id === "string") {
        requestId = parsed.request_id;
      }
      fieldErrors = toFieldErrors(parsed.errors);

      if (typeof detail === "string") {
        message = detail.trim();
      } else if (Array.isArray(detail)) {
        const legacyErrors = toFieldErrors(detail);
        if (!fieldErrors.length) {
          fieldErrors = legacyErrors;
        }
        message = joinFieldErrors(legacyErrors);
        if (code === `http_${status}` && status === 422) {
          code = "validation_error";
        }
      } else if (isRecord(detail)) {
        if (typeof detail.code === "string" && detail.code.trim()) {
          code = detail.code.trim();
        }
        if (typeof detail.message === "string") {
          message = detail.message.trim();
        } else if (typeof detail.detail === "string") {
          message = detail.detail.trim();
        }
      }

      if (!message && typeof parsed.message === "string") {
        message = parsed.message.trim();
      }
      if (!message && fieldErrors.length) {
        message = joinFieldErrors(fieldErrors);
      }
    } else if (parsed === undefined && !looksLikeHtml(body, contentType)) {
      const text = body.trim();
      message = text.length <= 300 ? text : "";
    }
  }

  if (!message) {
    message = fallbackMessageForStatus(status, retryAfterSeconds);
  }

  return new ApiError({
    code,
    message,
    details: body ? body.slice(0, 2000) : undefined,
    status,
    fieldErrors,
    retryAfterSeconds,
    requestId
  });
}

export function readErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message || fallbackMessage;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallbackMessage;
}
