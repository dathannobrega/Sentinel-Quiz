// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { GlossaryPopover, type GlossaryTarget } from "@/features/reading/components/glossary-popover";
import { LONG_PRESS_MS, ReadAlongBlock } from "@/features/reading/components/read-along-block";
import { flattenBlocks } from "@/features/reading/lib/blocks";
import { ApiError } from "@/lib/api/client";
import { I18nProvider } from "@/lib/i18n";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import type { ReadingGlossaryEntry, ReadingSectionDetail } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/read/s/x"
}));

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn<(path: string, body?: unknown) => Promise<unknown>>() }));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, post: (path: string, body?: unknown) => postMock(path, body) }, sendKeepaliveJson: vi.fn() };
});

const { t } = createTranslator(getMessages("pt-BR"));

const DETAIL: ReadingSectionDetail = {
  section_id: "book:c01:head-2-1",
  book_title: "Fake Security Guide",
  title: "Non-repudiation",
  breadcrumb: [],
  objectives: [],
  parts: [{ id: "p1", title: "Non-repudiation", depth: 1, blocks: [{ text: "Digital signatures provide repudiation protection." }] }],
  truncated: false,
  practice_questions: 0,
  book_slug: "book",
  chapter_file: "c01",
  chapter_index: 1,
  position: { index: 1, total: 1 },
  progress: null
};
const BLOCK = flattenBlocks(DETAIL)[0];

const ENTRY: ReadingGlossaryEntry = {
  word: "repudiation",
  word_norm: "repudiation",
  lemma: "repudiation",
  part_of_speech: "noun",
  ipa: "ɹᵻpjˌuːdɪˈeɪʃən",
  translation_pt: "repúdio",
  definition_en: "The act of denying having done something.",
  context_explanation_pt: "Aqui: negar ter assinado uma mensagem.",
  examples: ["Signatures prevent repudiation."],
  source: "ai",
  in_deck: false,
  card_id: null
};

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

/** The reader wiring in miniature: a block whose words open the popover. */
function Harness({ glossaryTap, onSeek }: { glossaryTap: boolean; onSeek: (index: number) => void }) {
  const [target, setTarget] = useState<GlossaryTarget | null>(null);
  return (
    <>
      <ReadAlongBlock
        block={BLOCK}
        position={1}
        total={1}
        active
        currentWordIndex={-1}
        follow={false}
        onActivate={() => {}}
        onWordClick={onSeek}
        glossaryTap={glossaryTap}
        onWordGlossary={(tokenIndex) => {
          const token = BLOCK.tokens[tokenIndex];
          setTarget({
            word: token.text,
            ref: { section_id: DETAIL.section_id, part_id: BLOCK.partId, block_index: BLOCK.blockIndex, char_start: token.start, char_end: token.end }
          });
        }}
      />
      <GlossaryPopover target={target} onClose={() => setTarget(null)} />
    </>
  );
}

function word(text: string): HTMLElement {
  const element = Array.from(document.querySelectorAll<HTMLElement>("[data-word]")).find((node) => node.textContent?.startsWith(text));
  if (!element) {
    throw new Error(`word ${text} not rendered`);
  }
  return element;
}

beforeEach(() => {
  postMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("glossary popover", () => {
  it("seeks on click without the toggle, and opens on double click", async () => {
    postMock.mockResolvedValue(ENTRY);
    const onSeek = vi.fn();
    render(wrap(<Harness glossaryTap={false} onSeek={onSeek} />));
    fireEvent.click(word("repudiation"));
    expect(onSeek).toHaveBeenCalledWith(3);
    expect(postMock).not.toHaveBeenCalled();
    fireEvent.doubleClick(word("repudiation"));
    await screen.findByText("repúdio");
  });

  it("opens with the toggle on, shows the entry and adds the word as vocabulary", async () => {
    postMock.mockImplementation((path: string) =>
      path === "/reading/glossary" ? Promise.resolve(ENTRY) : Promise.resolve({ id: "card-1", word: "repudiation", kind: "vocabulary" })
    );
    const onSeek = vi.fn();
    render(wrap(<Harness glossaryTap onSeek={onSeek} />));
    // Keyboard reachable: the words of the active block are buttons.
    const button = screen.getByRole("button", { name: t("reading.glossary.openFor", { word: "repudiation" }) });
    fireEvent.click(button);
    expect(onSeek).not.toHaveBeenCalled();
    await screen.findByText("repúdio");
    expect(postMock).toHaveBeenCalledWith("/reading/glossary", { section_id: DETAIL.section_id, part_id: "p1", block_index: 0, char_start: 27, char_end: 38 });
    const dialog = document.querySelector("dialog[open]") as HTMLElement;
    expect(dialog.textContent).toContain("/ɹᵻpjˌuːdɪˈeɪʃən/");
    expect(dialog.textContent).toContain(ENTRY.definition_en);
    expect(dialog.textContent).toContain(ENTRY.context_explanation_pt);
    expect(dialog.textContent).toContain(ENTRY.examples[0]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("reading.glossary.add")) }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/reading/words", {
        section_id: DETAIL.section_id,
        part_id: "p1",
        block_index: 0,
        char_start: 27,
        char_end: 38,
        kind: "vocabulary"
      })
    );
    await screen.findByText(t("reading.glossary.inDeck"));
  });

  it("opens with Enter on a focused word and with a touch long press", async () => {
    postMock.mockResolvedValue(ENTRY);
    render(wrap(<Harness glossaryTap onSeek={vi.fn()} />));
    fireEvent.keyDown(word("Digital"), { key: "Enter" });
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/reading/glossary", expect.objectContaining({ char_start: 0, char_end: 7 })));
    cleanup();

    vi.useFakeTimers();
    postMock.mockClear();
    render(wrap(<Harness glossaryTap={false} onSeek={vi.fn()} />));
    fireEvent.pointerDown(word("signatures"), { pointerType: "touch", clientX: 5, clientY: 5 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    });
    vi.useRealTimers();
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/reading/glossary", expect.objectContaining({ char_start: 8, char_end: 18 })));
  });

  it("shows only IPA and audio with a hint when the AI is off (source none)", async () => {
    postMock.mockResolvedValue({ ...ENTRY, source: "none", translation_pt: null, definition_en: null, context_explanation_pt: null, examples: [] });
    render(wrap(<Harness glossaryTap onSeek={vi.fn()} />));
    fireEvent.click(word("repudiation"));
    await screen.findByText(t("reading.glossary.aiOff"));
    const dialog = document.querySelector("dialog[open]") as HTMLElement;
    expect(dialog.textContent).toContain("/ɹᵻpjˌuːdɪˈeɪʃən/");
    expect(screen.getByRole("button", { name: t("reading.glossary.playWord", { word: "repudiation" }) })).toBeTruthy();
    expect(screen.queryByText(t("reading.glossary.translation"))).toBeNull();
  });

  it("explains the daily AI quota (429)", async () => {
    postMock.mockRejectedValue(new ApiError({ code: "reading_ai_quota_exceeded", message: "quota", status: 429 }));
    render(wrap(<Harness glossaryTap onSeek={vi.fn()} />));
    fireEvent.click(word("repudiation"));
    await screen.findByText(t("reading.glossary.errors.quota"));
  });
});
