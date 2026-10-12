// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { AssessmentResult } from "@/features/reading/components/assessment-result";
import { I18nProvider } from "@/lib/i18n";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import type { ReadingAssessment } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/read/s/x"
}));

const { t } = createTranslator(getMessages("pt-BR"));

const TEXT = "Security awareness training reduces phishing risk.";

const ASSESSMENT: ReadingAssessment = {
  attempt_id: "a1",
  created_at: "2026-10-12T10:00:00Z",
  engine: "faster-whisper",
  model: "small.en",
  duration_seconds: 4.2,
  speech_seconds: 3.9,
  transcript: "security awareness training reduces fishing",
  text: TEXT,
  words: [
    { index: 0, text: "Security", char_start: 0, char_end: 8, status: "ok", heard: "security", confidence: 0.95, start: 0.1, end: 0.5, expected_ipa: null, heard_ipa: null },
    { index: 1, text: "awareness", char_start: 9, char_end: 18, status: "weak", heard: "awareness", confidence: 0.4, start: 0.6, end: 1.1, expected_ipa: "əwˈɛɹnəs", heard_ipa: null },
    { index: 2, text: "training", char_start: 19, char_end: 27, status: "ok", heard: "training", confidence: 0.9, start: 1.2, end: 1.6, expected_ipa: null, heard_ipa: null },
    { index: 3, text: "reduces", char_start: 28, char_end: 35, status: "ok", heard: "reduces", confidence: 0.9, start: 1.7, end: 2.1, expected_ipa: null, heard_ipa: null },
    { index: 4, text: "phishing", char_start: 36, char_end: 44, status: "mispronounced", heard: "fishing", confidence: 0.8, start: 2.2, end: 2.7, expected_ipa: "fˈɪʃɪŋ", heard_ipa: "fˈɪʃɪŋ" },
    { index: 5, text: "risk", char_start: 45, char_end: 49, status: "missed", heard: null, confidence: null, start: null, end: null, expected_ipa: null, heard_ipa: null }
  ],
  extras: [{ text: "um", after_index: 1, start: 1.1, end: 1.2 }],
  scores: { accuracy: 0.75, completeness: 0.8333, fluency: 0.6, overall: 0.7367 },
  metrics: { reference_words: 6, ok: 3, weak: 1, mispronounced: 1, missed: 1, extra: 1, wpm: 128.4, long_pauses: 1, target_wpm: [120, 170] },
  tips: [{ code: "phoneme_confusion", expected: "θ", heard: "t", examples: ["think", "threat"] }],
  best_overall: 0.81,
  attempts_for_block: 3
};

function wrap(node: ReactNode) {
  return (
    <I18nProvider locale="pt-BR" localeFromCookie>
      {node}
    </I18nProvider>
  );
}

afterEach(() => cleanup());

describe("AssessmentResult", () => {
  it("renders every word status with a text legend and the heard word for mispronunciations", () => {
    render(wrap(<AssessmentResult assessment={ASSESSMENT} />));
    const legend = screen.getByRole("list", { name: t("reading.result.legend") });
    for (const key of ["statusOk", "statusWeak", "statusMispronounced", "statusMissed", "statusExtra"]) {
      expect(within(legend).getByText(t(`reading.result.${key}`))).toBeTruthy();
    }
    const mispronounced = screen.getByRole("button", { name: /phishing/ });
    expect(mispronounced.textContent).toContain(t("reading.result.heard", { heard: "fishing" }));
    expect(mispronounced.getAttribute("title")).toContain(t("reading.result.statusMispronounced"));
    expect(mispronounced.getAttribute("title")).toContain("/fˈɪʃɪŋ/");
    expect(mispronounced.className).toContain("decoration-danger");
    const missed = screen.getByRole("button", { name: /risk/ });
    expect(missed.className).toContain("line-through");
    const weak = screen.getByRole("button", { name: /awareness/ });
    expect(weak.className).toContain("decoration-dotted");
    expect(screen.getByText("+um")).toBeTruthy();
  });

  it("shows the four scores as percentages, the pace metrics and the tips", () => {
    render(wrap(<AssessmentResult assessment={ASSESSMENT} />));
    expect(screen.getByText("74%")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("83%")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getAllByRole("meter")).toHaveLength(4);
    expect(screen.getByText(t("reading.result.wpm", { wpm: 128 }))).toBeTruthy();
    expect(screen.getByText(t("reading.result.pauses", { count: 1 }))).toBeTruthy();
    expect(screen.getByText(t("reading.result.tips.phoneme_confusion", { expected: "/θ/", heard: "/t/", examples: "think, threat" }))).toBeTruthy();
    expect(screen.getByText(t("reading.shadow.attemptsCount", { count: 3, best: 81 }))).toBeTruthy();
  });

  it("opens the word details on tap and plays the model word", () => {
    const onPlayWord = vi.fn();
    const onTryAgain = vi.fn();
    render(wrap(<AssessmentResult assessment={ASSESSMENT} onPlayWord={onPlayWord} onTryAgain={onTryAgain} />));
    fireEvent.click(screen.getByRole("button", { name: /phishing/ }));
    const details = screen.getByRole("status");
    expect(details.textContent).toContain(t("reading.result.expectedIpa", { ipa: "/fˈɪʃɪŋ/" }));
    fireEvent.click(within(details).getByRole("button", { name: t("reading.result.playWord", { word: "phishing" }) }));
    expect(onPlayWord).toHaveBeenCalledWith(expect.objectContaining({ index: 4 }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("reading.shadow.tryAgain")) }));
    expect(onTryAgain).toHaveBeenCalled();
  });
});
