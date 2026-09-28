import {
  clearStoredAuthToken,
  getOrCreateClientKey,
  getStoredAuthToken
} from "@/lib/auth/storage";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { ApiError, apiMessage, normalizeErrorResponse } from "@/lib/api/errors";

export { ApiError, isApiError, isUnauthorizedError, readErrorMessage } from "@/lib/api/errors";

/** Per-request timeouts (ms). The tutor waits on an LLM; admin jobs touch the whole bank. */
export const API_TIMEOUTS = {
  default: 15_000,
  tutor: 45_000,
  adminLong: 120_000
} as const;

export type RequestOptions = Omit<RequestInit, "body" | "headers" | "signal"> & {
  body?: unknown;
  headers?: HeadersInit;
  /** Abort after this many ms (fresh timer per attempt). */
  timeoutMs?: number;
  /** Retry once without the in-memory Bearer token when it was rejected. Default true. */
  retryOnUnauthorized?: boolean;
  /** External cancellation (e.g. react-query's `signal`). */
  signal?: AbortSignal;
  /**
   * When false, a 401 does not notify the global unauthorized handler (used by login,
   * register and other endpoints where 401 means "bad credentials", not "session gone").
   */
  notifyUnauthorized?: boolean;
};

type MethodOptions = Omit<RequestOptions, "method" | "body">;

type UnauthorizedHandler = (path: string) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registered by the query provider: clears the cached current user when the session is gone. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function resolveApiOrigin(): string {
  const configuredOrigin = getRuntimeConfig().apiOrigin;
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

export function buildApiUrl(path: string): string {
  const apiOrigin = resolveApiOrigin();
  const normalizedPath = path.startsWith("/api") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;
  return `${apiOrigin}${normalizedPath}`;
}

function isCrossOriginApi(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const configured = getRuntimeConfig().apiOrigin;
  if (!configured) {
    return false;
  }
  try {
    return new URL(configured).origin !== window.location.origin;
  } catch {
    return false;
  }
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  return normalizeErrorResponse({
    status: response.status,
    body,
    contentType: response.headers.get("content-type"),
    retryAfter: response.headers.get("retry-after"),
    requestId: response.headers.get("x-request-id")
  });
}

function buildHeaders(options: RequestOptions): { headers: Headers; body: BodyInit | undefined } {
  const headers = new Headers(options.headers);
  headers.set("X-Client-Key", getOrCreateClientKey());
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const authToken = getStoredAuthToken();
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined && options.body !== null) {
    if (options.body instanceof FormData || options.body instanceof Blob) {
      body = options.body;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
  }
  return { headers, body };
}

function toNetworkError(error: unknown): ApiError {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    return new ApiError({ code: "offline", message: apiMessage("offline"), status: 0 });
  }
  const crossOrigin = isCrossOriginApi();
  return new ApiError({
    code: crossOrigin ? "network_blocked" : "network_error",
    message: crossOrigin ? apiMessage("blocked") : apiMessage("network"),
    details: error instanceof Error ? error.message : String(error),
    status: 0
  });
}

/**
 * Performs a single attempt with its own AbortController and timer, so retries never reuse
 * an already-aborted signal or a timer that is about to fire.
 */
async function executeAttempt(path: string, options: RequestOptions): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? API_TIMEOUTS.default;
  let timedOut = false;
  const timeoutHandle = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const { headers, body } = buildHeaders(options);
  const {
    timeoutMs: _timeoutMs,
    retryOnUnauthorized: _retry,
    notifyUnauthorized: _notify,
    signal: _signal,
    body: _body,
    headers: _headers,
    ...init
  } = options;

  try {
    return await fetch(buildApiUrl(path), {
      ...init,
      body,
      headers,
      signal: controller.signal,
      credentials: "include"
    });
  } catch (error) {
    if (externalSignal?.aborted && !timedOut) {
      // Propagate cancellation untouched so react-query can treat it as a cancel.
      throw error;
    }
    if (timedOut) {
      throw new ApiError({ code: "timeout", message: apiMessage("timeout"), status: 408 });
    }
    throw toNetworkError(error);
  } finally {
    globalThis.clearTimeout(timeoutHandle);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

async function performRequest(path: string, options: RequestOptions): Promise<Response> {
  let response = await executeAttempt(path, options);

  if (response.status === 401 && getStoredAuthToken() && options.retryOnUnauthorized !== false) {
    // The in-memory Bearer token is stale; fall back to the HttpOnly cookie session.
    clearStoredAuthToken();
    response = await executeAttempt(path, options);
  }

  if (!response.ok) {
    const error = await parseErrorResponse(response);
    if (response.status === 401 && options.notifyUnauthorized !== false) {
      unauthorizedHandler?.(path);
    }
    throw error;
  }
  return response;
}

async function sendRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await performRequest(path, options);

  if (response.status === 204) {
    return null as T;
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null as T;
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({ code: "invalid_json", message: apiMessage("server"), status: response.status });
  }
}

export interface DownloadedFile {
  blob: Blob;
  filename: string | null;
  contentType: string;
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const encoded = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // Fall through to the plain filename.
    }
  }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain?.[1]?.trim() || null;
}

/** Fetches a binary payload (e.g. /admin/export) with the same auth, timeout and error handling. */
async function downloadFile(path: string, options: RequestOptions = {}): Promise<DownloadedFile> {
  const response = await performRequest(path, {
    ...options,
    headers: { Accept: "*/*", ...(options.headers as Record<string, string> | undefined) }
  });
  const blob = await response.blob();
  return {
    blob,
    filename: parseContentDispositionFilename(response.headers.get("content-disposition")),
    contentType: response.headers.get("content-type") || blob.type || "application/octet-stream"
  };
}

/** Triggers a browser download for a blob without leaving the page. */
export function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export const apiClient = {
  get<T>(path: string, options?: MethodOptions) {
    return sendRequest<T>(path, { ...options, method: "GET" });
  },
  post<T>(path: string, body?: unknown, options?: MethodOptions) {
    return sendRequest<T>(path, { ...options, method: "POST", body });
  },
  put<T>(path: string, body?: unknown, options?: MethodOptions) {
    return sendRequest<T>(path, { ...options, method: "PUT", body });
  },
  patch<T>(path: string, body?: unknown, options?: MethodOptions) {
    return sendRequest<T>(path, { ...options, method: "PATCH", body });
  },
  delete<T>(path: string, options?: MethodOptions) {
    return sendRequest<T>(path, { ...options, method: "DELETE" });
  },
  getText(path: string, options?: MethodOptions): Promise<string> {
    return performRequest(path, {
      ...options,
      method: "GET",
      headers: { Accept: "text/html, text/plain;q=0.9, */*;q=0.1", ...(options?.headers as Record<string, string> | undefined) }
    }).then((response) => response.text());
  },
  download(path: string, options?: MethodOptions & { method?: string; body?: unknown }) {
    return downloadFile(path, { ...options, method: options?.method ?? "GET" });
  }
};
