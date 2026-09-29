// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthShell } from "@/features/auth/components/auth-shell";
import { VerifyEmailPanel } from "@/features/auth/components/verify-email-panel";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import { I18nProvider } from "@/lib/i18n/provider";
import { queryKeys } from "@/lib/query/keys";

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParams,
  usePathname: () => "/"
}));

const { t } = createTranslator(getMessages("en-US"));

const USER = {
  id: "u1",
  email: "ana@example.com",
  display_name: "Ana",
  role: "student",
  is_active: true,
  email_verified: true,
  created_at: "2026-01-02T03:04:05+00:00"
};

interface MockResponse {
  status: number;
  body?: unknown;
}

type Route = (init: RequestInit) => MockResponse;

let routes: Record<string, Route>;
const calls: Array<{ path: string; body: unknown }> = [];

function jsonResponse({ status, body }: MockResponse): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

beforeEach(() => {
  calls.length = 0;
  searchParams = new URLSearchParams();
  Object.values(router).forEach((fn) => fn.mockReset());
  routes = {
    "/api/auth/me": () => ({ status: 401, body: { detail: "Not authenticated", code: "unauthorized" } })
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), "http://localhost").pathname;
      calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const route = routes[path];
      if (!route) {
        return jsonResponse({ status: 404, body: { detail: "missing mock", code: "not_found" } });
      }
      return jsonResponse(route(init));
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en-US" localeFromCookie>
        {node}
      </I18nProvider>
    </QueryClientProvider>
  );
  return client;
}

async function fillAndSubmit(fields: { email: string; password: string }, submitLabel: string) {
  const email = await screen.findByLabelText(t("auth.form.email"));
  fireEvent.change(email, { target: { value: fields.email } });
  fireEvent.change(screen.getByLabelText(t("auth.form.password")), { target: { value: fields.password } });
  fireEvent.click(screen.getByRole("button", { name: submitLabel }));
}

describe("register (contract r4 §1)", () => {
  it("shows the check-your-e-mail state on 202 verification_required and can resend", async () => {
    routes["/api/auth/register"] = () => ({
      status: 202,
      body: { status: "verification_required", code: "verification_required", detail: "Check your inbox." }
    });
    routes["/api/auth/request-email-verification"] = () => ({ status: 200, body: { ok: true, message: "sent" } });
    const client = renderWithProviders(<AuthShell mode="register" />);

    await fillAndSubmit({ email: "ana@example.com", password: "supersecret" }, t("common.actions.createAccount"));

    const panel = await screen.findByTestId("register-check-email");
    expect(panel.textContent).toContain(t("auth.verification.checkEmailTitle"));
    expect(panel.textContent).toContain("ana@example.com");
    expect(router.push).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.currentUser)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("auth.verification.resend") }));
    await screen.findByText(t("auth.notices.verificationResent"));
    expect(calls.find((call) => call.path === "/api/auth/request-email-verification")?.body).toEqual({
      email: "ana@example.com"
    });

    fireEvent.click(screen.getByRole("button", { name: t("auth.verification.useAnotherEmail") }));
    expect(screen.queryByTestId("register-check-email")).toBeNull();
    expect(screen.getByLabelText(t("auth.form.email"))).toBeTruthy();
  });

  it("keeps the legacy flow: 200 + user signs in and redirects to next", async () => {
    searchParams = new URLSearchParams("next=/history");
    routes["/api/auth/register"] = () => ({ status: 200, body: { user: USER, token: null } });
    const client = renderWithProviders(<AuthShell mode="register" />);

    await fillAndSubmit({ email: "ana@example.com", password: "supersecret" }, t("common.actions.createAccount"));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/history"));
    expect(client.getQueryData(queryKeys.currentUser)).toMatchObject({ email: "ana@example.com" });
    expect(screen.queryByTestId("register-check-email")).toBeNull();
  });
});

describe("login (contract r4 §1)", () => {
  it("explains 403 email_not_verified and offers to resend the link", async () => {
    routes["/api/auth/login"] = () => ({
      status: 403,
      body: { detail: "Email not verified.", code: "email_not_verified" }
    });
    routes["/api/auth/request-email-verification"] = () => ({ status: 200, body: { ok: true, message: "sent" } });
    renderWithProviders(<AuthShell mode="login" />);

    await fillAndSubmit({ email: "bob@example.com", password: "supersecret" }, t("common.actions.signIn"));

    const banner = await screen.findByText(t("auth.verification.notVerifiedTitle"));
    expect(banner.closest("[role=status]")?.textContent).toContain(t("auth.verification.notVerifiedMessage"));
    expect(router.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("auth.verification.resend") }));
    await screen.findByText(t("auth.notices.verificationResent"));
    expect(calls.find((call) => call.path === "/api/auth/request-email-verification")?.body).toEqual({
      email: "bob@example.com"
    });
  });

  it("keeps the generic failure for 401 invalid_credentials (no resend offered)", async () => {
    routes["/api/auth/login"] = () => ({
      status: 401,
      body: { detail: "Invalid credentials.", code: "invalid_credentials" }
    });
    renderWithProviders(<AuthShell mode="login" />);

    await fillAndSubmit({ email: "bob@example.com", password: "wrongpass" }, t("common.actions.signIn"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Invalid credentials.");
    expect(screen.queryByRole("button", { name: t("auth.verification.resend") })).toBeNull();
  });
});

describe("verify-email (contract r4 §1)", () => {
  it("stores the signed-in user in the current-user cache and redirects to next", async () => {
    searchParams = new URLSearchParams("token=abc123&next=/start");
    routes["/api/auth/verify-email"] = () => ({ status: 200, body: { user: USER, token: null } });
    const client = renderWithProviders(<VerifyEmailPanel />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/start"));
    expect(client.getQueryData(queryKeys.currentUser)).toMatchObject({ id: "u1", email_verified: true });
    expect(calls.filter((call) => call.path === "/api/auth/verify-email")).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ token: "abc123" });
  });

  it("defaults the redirect to /dashboard and ignores unsafe next values", async () => {
    searchParams = new URLSearchParams("token=abc123&next=//evil.example");
    routes["/api/auth/verify-email"] = () => ({ status: 200, body: { user: USER, token: null } });
    renderWithProviders(<VerifyEmailPanel />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("legacy bare-user response: shows success without redirecting", async () => {
    searchParams = new URLSearchParams("token=abc123");
    routes["/api/auth/verify-email"] = () => ({ status: 200, body: USER });
    renderWithProviders(<VerifyEmailPanel />);

    await screen.findByText(t("password.verify.successTitle"));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows the backend error for an invalid token", async () => {
    searchParams = new URLSearchParams("token=bad");
    routes["/api/auth/verify-email"] = () => ({ status: 400, body: { detail: "Invalid token.", code: "invalid_token" } });
    renderWithProviders(<VerifyEmailPanel />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Invalid token.");
    expect(router.replace).not.toHaveBeenCalled();
  });
});
