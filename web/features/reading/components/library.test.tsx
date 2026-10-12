// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ReadingLibrary } from "@/features/reading/components/library";
import { I18nProvider } from "@/lib/i18n";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import type { ReadingCapabilities, ReadingLibrary as ReadingLibraryPayload, ReadingStats } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/read"
}));

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn<(path: string) => Promise<unknown>>() }));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: (path: string) => getMock(path) },
    sendKeepaliveJson: vi.fn()
  };
});

const { t } = createTranslator(getMessages("pt-BR"));

const CAPABILITIES_OK: ReadingCapabilities = {
  enabled: true,
  books_available: true,
  tts: {
    available: true,
    reason: null,
    engine: "kokoro",
    model: "hexgrad/Kokoro-82M",
    default_voice: "af_heart",
    voices: [{ id: "af_heart", label: "Heart", lang: "en-US", gender: "female" }],
    speeds: [0.75, 0.9, 1, 1.1, 1.25]
  },
  assess: { available: true, reason: null, engine: "faster-whisper", model: "small.en", max_audio_bytes: 8_000_000, max_seconds: 90 },
  quota: { daily_limit: 400, used_today: 3, remaining: 397 }
};

const LIBRARY: ReadingLibraryPayload = {
  books: [
    {
      slug: "comptia_security_plus_sy0_701",
      title: "CompTIA Security+ Study Guide Exam SY0-701",
      certification: "CompTIA Security+ (SY0-701)",
      words: 543_467,
      minutes: 3623,
      sections: 812,
      chapters: [
        { file: "c01", index: 1, title: "Today's Security Professional", sections: 41, words: 21_000, minutes: 140 },
        { file: "c02", index: 2, title: "Cybersecurity Threat Landscape", sections: 38, words: 19_000, minutes: 127 }
      ],
      progress: {
        section_id: "comptia_security_plus_sy0_701:c04:head-3-30",
        section_title: "Smishing",
        part_id: "p1",
        block_index: 2,
        percent: 12.5,
        mode: "listen",
        words_read: 5300,
        seconds_listened: 2100,
        updated_at: "2026-10-12T10:00:00Z"
      }
    },
    {
      slug: "cissp_official_study_guide",
      title: "CISSP Official Study Guide",
      certification: "ISC2 CISSP",
      words: 700_000,
      minutes: 4667,
      sections: 1000,
      chapters: [{ file: "c01", index: 1, title: "Security Governance", sections: 50, words: 30_000, minutes: 200 }],
      progress: null
    }
  ]
};

const STATS: ReadingStats = {
  attempts: 57,
  avg_overall: 0.82,
  best_overall: 0.97,
  words_read: 12_000,
  seconds_listened: 5400,
  active_days_30: 9,
  recent: []
};

function respond(capabilities: ReadingCapabilities = CAPABILITIES_OK, library: ReadingLibraryPayload = LIBRARY) {
  getMock.mockImplementation((path: string) => {
    const url = path;
    if (url.endsWith("/reading/capabilities")) {
      return Promise.resolve(capabilities);
    }
    if (url.endsWith("/reading/library")) {
      return Promise.resolve(library);
    }
    if (url.endsWith("/reading/stats")) {
      return Promise.resolve(STATS);
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
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
});
afterEach(() => cleanup());

describe("ReadingLibrary", () => {
  it("lists the books with their numbers and links continue / start appropriately", async () => {
    respond();
    render(wrap(<ReadingLibrary />));
    await screen.findByRole("heading", { level: 3, name: "CompTIA Security+ Study Guide Exam SY0-701" });

    const cards = screen.getAllByRole("listitem").filter((item) => item.querySelector("h3"));
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain(t("reading.library.chapters", { count: 2 }));
    expect(cards[0].textContent).toContain(t("reading.library.percentRead", { percent: 13 }));
    expect(cards[1].textContent).toContain(t("reading.library.notStarted"));

    const continueLinks = screen.getAllByRole("link", { name: new RegExp(t("reading.library.continueButton")) });
    for (const link of continueLinks) {
      expect(link.getAttribute("href")).toBe(`/read/s/${encodeURIComponent("comptia_security_plus_sy0_701:c04:head-3-30")}`);
    }
    const start = within(cards[1]).getByRole("link", { name: new RegExp(t("reading.library.startButton")) });
    expect(start.getAttribute("href")).toBe("/read/cissp_official_study_guide");
  });

  it("shows the continue-reading card for the most recent progress and the stats strip", async () => {
    respond();
    render(wrap(<ReadingLibrary />));
    const card = await screen.findByRole("region", { name: t("reading.library.continueTitle") });
    expect(card.textContent).toContain(t("reading.library.continueFrom", { section: "Smishing" }));
    expect(card.textContent).toContain("CompTIA Security+ Study Guide Exam SY0-701");

    await waitFor(() => expect(screen.getByText("57")).toBeTruthy());
    expect(screen.getByText("82%")).toBeTruthy();
    expect(screen.getByText("90")).toBeTruthy(); // 5400 s listened
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns about the browser fallback when the speech service is unavailable", async () => {
    respond({
      ...CAPABILITIES_OK,
      tts: { ...CAPABILITIES_OK.tts!, available: false, reason: "speech_unavailable" },
      assess: { ...CAPABILITIES_OK.assess!, available: false, reason: "speech_unavailable" }
    });
    render(wrap(<ReadingLibrary />));
    await screen.findByText(t("reading.capabilities.ttsUnavailableTitle"));
    expect(screen.getByText(t("reading.capabilities.ttsUnavailable"))).toBeTruthy();
    expect(screen.getByText(t("reading.capabilities.assessUnavailableTitle"))).toBeTruthy();
  });

  it("shows the empty state when no books are mounted", async () => {
    respond({ ...CAPABILITIES_OK, books_available: false }, { books: [] });
    render(wrap(<ReadingLibrary />));
    await screen.findByText(t("reading.library.emptyTitle"));
    expect(screen.queryByRole("region", { name: t("reading.library.continueTitle") })).toBeNull();
  });

  it("links to the due words and offline chapters and offers export/delete on Increment 2 APIs", async () => {
    respond({ ...CAPABILITIES_OK, words: { due: 3 }, offline: { max_chapters: 5 }, ai: { available: true, reason: null, provider: "fake" } });
    render(wrap(<ReadingLibrary />));
    const due = await screen.findByRole("link", { name: new RegExp(t("reading.words.libraryDue", { count: 3 }).replace(/[()]/g, "\\$&")) });
    expect(due.getAttribute("href")).toBe("/read/words");
    expect(screen.getByRole("link", { name: new RegExp(t("reading.offline.libraryLink")) }).getAttribute("href")).toBe("/read/offline");
    expect(screen.getByRole("heading", { name: t("reading.data.title") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(t("reading.data.export").replace(/[()]/g, "\\$&")) })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("reading.data.delete") })).toBeTruthy();
  });

  it("hides the Increment 2 links on older APIs", async () => {
    respond();
    render(wrap(<ReadingLibrary />));
    await screen.findByRole("heading", { level: 3, name: "CompTIA Security+ Study Guide Exam SY0-701" });
    expect(screen.queryByRole("link", { name: new RegExp(t("reading.offline.libraryLink")) })).toBeNull();
    expect(screen.queryByRole("heading", { name: t("reading.data.title") })).toBeNull();
  });
});
