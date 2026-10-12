// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WordsPage } from "@/features/reading/components/words-page";
import { I18nProvider } from "@/lib/i18n";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import type { ReadingWordCard, ReadingWordList, ReadingWordSummary } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/read/words"
}));

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn<(path: string) => Promise<unknown>>(),
  postMock: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  deleteMock: vi.fn<(path: string) => Promise<unknown>>()
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: (path: string) => getMock(path),
      post: (path: string, body?: unknown) => postMock(path, body),
      delete: (path: string) => deleteMock(path)
    },
    sendKeepaliveJson: vi.fn()
  };
});

const { t } = createTranslator(getMessages("pt-BR"));

function card(overrides: Partial<ReadingWordCard>): ReadingWordCard {
  return {
    id: "w1",
    word: "repudiation",
    kind: "vocabulary",
    ipa: "ɹᵻpjˌuːdɪˈeɪʃən",
    meaning_pt: "repúdio",
    context: "Non-repudiation prevents denial of an action.",
    section_id: "book:c01:head-2-1",
    source: "glossary",
    reps: 0,
    lapses: 0,
    ease: 2.5,
    interval_days: 0,
    due_at: "2020-01-01T00:00:00Z",
    last_score: null,
    last_reviewed_at: null,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides
  };
}

const VOCAB = card({});
const PRON = card({ id: "w2", word: "phishing", kind: "pronunciation", source: "assessment", meaning_pt: null, last_score: 0.42, due_at: "2099-01-01T00:00:00Z" });
const SUMMARY: ReadingWordSummary = { total: 2, due: 1, learned: 0, by_kind: { vocabulary: 1, pronunciation: 1 } };

function respond(summary = SUMMARY) {
  getMock.mockImplementation((path: string) => {
    if (path.endsWith("/reading/words/summary")) {
      return Promise.resolve(summary);
    }
    if (path.includes("/reading/words?")) {
      const params = new URLSearchParams(path.split("?")[1]);
      const kind = params.get("kind");
      const status = params.get("status");
      let items = [VOCAB, PRON];
      if (kind) {
        items = items.filter((item) => item.kind === kind);
      }
      if (status === "due") {
        items = [VOCAB];
      }
      const list: ReadingWordList = { items, total: items.length, due: 1 };
      return Promise.resolve(list);
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="pt-BR" localeFromCookie>
        {node}
      </I18nProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  deleteMock.mockReset();
});
afterEach(() => cleanup());

describe("WordsPage", () => {
  it("shows the summary and the full list with kind badges and due state", async () => {
    respond();
    render(wrap(<WordsPage />));
    await screen.findByText("repudiation");
    const summary = screen.getByRole("heading", { name: t("reading.words.summary.title") }).closest("section");
    expect(summary?.textContent).toContain(t("reading.words.summary.due"));
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain(t("reading.words.kinds.vocabulary"));
    expect(rows[0].textContent).toContain(t("reading.words.list.dueNow"));
    expect(rows[1].textContent).toContain(t("reading.words.kinds.pronunciation"));
    expect(rows[1].textContent).toContain(t("reading.words.list.lastScore", { percent: 42 }));
  });

  it("filters by kind through the API", async () => {
    respond();
    render(wrap(<WordsPage />));
    await screen.findByText("repudiation");
    fireEvent.change(screen.getByLabelText(t("reading.words.filter.label")), { target: { value: "pronunciation" } });
    await screen.findByText("phishing");
    expect(screen.queryByText("repudiation")).toBeNull();
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining("kind=pronunciation"));
  });

  it("deletes a word after confirming", async () => {
    respond();
    deleteMock.mockResolvedValue(null);
    render(wrap(<WordsPage />));
    await screen.findByText("repudiation");
    fireEvent.click(screen.getByRole("button", { name: t("reading.words.list.deleteWord", { word: "repudiation" }) }));
    const dialog = document.querySelector("dialog[open]") as HTMLElement;
    expect(dialog.textContent).toContain(t("reading.words.list.deleteMessage", { word: "repudiation" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("reading.words.list.delete") }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/reading/words/w1"));
  });

  it("runs a vocabulary review: front, reveal, grade", async () => {
    respond();
    postMock.mockResolvedValue({ ...VOCAB, reps: 1 });
    render(wrap(<WordsPage />));
    const start = await screen.findByRole("button", { name: new RegExp(t("reading.words.reviewNow")) });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    await screen.findByText(t("reading.words.session.progress", { index: 1, total: 1 }));
    expect(screen.getByText("“Non-repudiation prevents denial of an action.”")).toBeTruthy();
    expect(screen.queryByText("repúdio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("reading.words.session.reveal") }));
    expect(screen.getByText("repúdio")).toBeTruthy();
    const grades = screen.getByRole("group", { name: t("reading.words.session.gradeLabel") });
    expect(within(grades).getAllByRole("button")).toHaveLength(4);
    fireEvent.click(within(grades).getByRole("button", { name: t("reading.words.grades.good") }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/reading/words/w1/grade", { grade: "good" }));
    await screen.findByText(t("reading.words.session.done", { count: 1 }));
  });

  it("disables the review when nothing is due", async () => {
    respond({ ...SUMMARY, due: 0 });
    render(wrap(<WordsPage />));
    await screen.findByText(t("reading.words.reviewEmpty"));
    expect((screen.getByRole("button", { name: new RegExp(t("reading.words.reviewNow")) }) as HTMLButtonElement).disabled).toBe(true);
  });
});
