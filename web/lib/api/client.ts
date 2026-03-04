import {
  clearStoredAuthToken,
  getOrCreateClientKey,
  getStoredAuthToken
} from "@/lib/auth/storage";
import { getRuntimeConfig } from "@/lib/config/runtime";
import type { ApiErrorPayload } from "@/types/api";

export class ApiError extends Error {
  code: string;
  details?: string;
  status: number;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.details = payload.details;
    this.status = payload.status ?? 500;
  }
}

type RequestOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: HeadersInit;
  timeoutMs?: number;
  retryOnUnauthorized?: boolean;
};

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

async function parseErrorResponse(response: Response): Promise<ApiError> {
  const rawBody = await response.text();
  if (!rawBody) {
    return new ApiError({
      code: `http_${response.status}`,
      message: `HTTP ${response.status}`,
      status: response.status
    });
  }

  try {
    const parsed = JSON.parse(rawBody) as { detail?: string; message?: string; code?: string };
    const message = String(parsed.detail || parsed.message || "").trim();
    if (message) {
      return new ApiError({
        code: parsed.code || `http_${response.status}`,
        message,
        details: rawBody,
        status: response.status
      });
    }
  } catch {
    // Fall through to plain-text error normalization.
  }

  return new ApiError({
    code: `http_${response.status}`,
    message: rawBody,
    details: rawBody,
    status: response.status
  });
}

async function sendRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 12000;
  const timeoutHandle = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  const execute = async (): Promise<Response> => {
    const headers = new Headers(options.headers);
    headers.set("X-Client-Key", getOrCreateClientKey());

    const authToken = getStoredAuthToken();
    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined && options.body !== null) {
      if (options.body instanceof FormData) {
        body = options.body;
      } else {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(options.body);
      }
    }

    return fetch(buildApiUrl(path), {
      ...options,
      body,
      headers,
      signal: controller.signal,
      credentials: "include"
    });
  };

  try {
    let response = await execute();

    if (response.status === 401 && getStoredAuthToken() && options.retryOnUnauthorized !== false) {
      clearStoredAuthToken();
      response = await execute();
    }

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return null as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError({
        code: "timeout",
        message: "A requisicao demorou mais do que o esperado. Tente novamente.",
        status: 408
      });
    }

    throw new ApiError({
      code: "network_error",
      message: "Nao foi possivel falar com o backend agora.",
      details: error instanceof Error ? error.message : String(error),
      status: 503
    });
  } finally {
    globalThis.clearTimeout(timeoutHandle);
  }
}

export const apiClient = {
  get<T>(path: string, options?: Omit<RequestOptions, "method" | "body">) {
    return sendRequest<T>(path, {
      ...options,
      method: "GET"
    });
  },
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) {
    return sendRequest<T>(path, {
      ...options,
      method: "POST",
      body
    });
  },
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) {
    return sendRequest<T>(path, {
      ...options,
      method: "PUT",
      body
    });
  },
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) {
    return sendRequest<T>(path, {
      ...options,
      method: "PATCH",
      body
    });
  },
  delete<T>(path: string, options?: Omit<RequestOptions, "method" | "body">) {
    return sendRequest<T>(path, {
      ...options,
      method: "DELETE"
    });
  }
};
