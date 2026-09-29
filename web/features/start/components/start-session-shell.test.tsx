// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { StartSessionShell } from "@/features/start/components/start-session-shell";
import { apiClient } from "@/lib/api/client";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Exam } from "@/types/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/start",
  useSearchParams: () => new URLSearchParams()
}));

const { t } = createTranslator(getMessages("en-US"));

// The certification list comes only from /api/exams: a new certification (CEH) needs no code change.
const EXAMS: Exam[] = [
  { id: "securityplus", title: "CompTIA Security+ SY0-701", question_count: 900 },
  { id: "cissp", title: "ISC2 CISSP", question_count: 700 },
  { id: "ceh", title: "EC-Council CEH v13", question_count: 400 }
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="en-US" localeFromCookie>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(apiClient, "get").mockImplementation(async (path: string) => {
    if (path === "/exams") {
      return EXAMS;
    }
    if (path.startsWith("/domains")) {
      return { exam_id: null, domains: [] };
    }
    if (path.startsWith("/questions/search")) {
      return { items: [], total: 0, limit: 8, offset: 0, applied_filters: {} };
    }
    throw new Error(`unexpected GET ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
});

describe("start session launcher", () => {
  it("lists certifications from /api/exams, CEH included", async () => {
    render(<StartSessionShell />, { wrapper });
    const select = await screen.findByLabelText(t("launcher.fields.certification"));
    const labels = within(select).getAllByRole("option").map((option) => option.textContent);
    expect(labels).toEqual([t("common.filters.mixedRandom"), ...EXAMS.map((exam) => exam.title)]);
  });

  it("offers 0–5 PBQs (default 0) and sends pbq_count for exams", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ id: "new-exam" });
    render(<StartSessionShell />, { wrapper });
    const pbq = (await screen.findByLabelText(t("launcher.fields.pbqCount"))) as HTMLSelectElement;
    expect(pbq.value).toBe("0");
    expect(within(pbq).getAllByRole("option").map((option) => (option as HTMLOptionElement).value)).toEqual(["0", "1", "2", "3", "4", "5"]);

    fireEvent.change(screen.getByLabelText(t("launcher.fields.certification")), { target: { value: "ceh" } });
    fireEvent.change(pbq, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: t("launcher.actions.createExam") }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/sessions");
    expect(body).toMatchObject({ exam_id: "ceh", pbq_count: 2 });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/exam/new-exam"));
  });

  it("sends pbq_count for study blocks too (0 by default)", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ id: "new-study" });
    render(<StartSessionShell />, { wrapper });
    fireEvent.change(await screen.findByLabelText(t("launcher.fields.mode")), { target: { value: "study" } });
    fireEvent.click(screen.getByRole("button", { name: t("launcher.actions.createStudyBlock") }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/study/sessions");
    expect(body).toMatchObject({ pbq_count: 0 });
  });

  it("clamps a stored out-of-range PBQ count", async () => {
    window.localStorage.setItem("sentinel.start.launch_filters", JSON.stringify({ pbqCount: 42 }));
    render(<StartSessionShell />, { wrapper });
    const pbq = (await screen.findByLabelText(t("launcher.fields.pbqCount"))) as HTMLSelectElement;
    await waitFor(() => expect(pbq.value).toBe("5"));
  });
});
