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
    const details = screen.getByRole("region", { name: t("reading.result.wordDetails") });
    expect(details.textContent).toContain("/fˈɪʃɪŋ/");
    expect(details.textContent).toContain(t("reading.result.expected"));
    fireEvent.click(within(details).getByRole("button", { name: t("reading.result.playWord", { word: "phishing" }) }));
    expect(onPlayWord).toHaveBeenCalledWith(expect.objectContaining({ index: 4 }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("reading.shadow.tryAgain")) }));
    expect(onTryAgain).toHaveBeenCalled();
  });

  it("notes that phoneme analysis is off when the engine is absent", () => {
    render(wrap(<AssessmentResult assessment={ASSESSMENT} />));
    expect(screen.getByText(t("reading.result.phonemesOff"))).toBeTruthy();
  });
});

const PHONEME_ASSESSMENT: ReadingAssessment = {
  ...ASSESSMENT,
  words: [
    {
      ...ASSESSMENT.words[0],
      status: "mispronounced",
      reason: "phoneme",
      phoneme_score: 0.54,
      expected_ipa: "sɪkjˈʊɹᵻɾi",
      heard_ipa: "sɪkjʊɹɪti",
      phonemes: [
        { ipa: "s", score: 0.95, heard: "s", quality: "good" },
        { ipa: "ɪ", score: 0.41, heard: "i", quality: "bad" },
        { ipa: "k", score: 0.6, heard: "k", quality: "fair" }
      ],
      break: null
    },
    { ...ASSESSMENT.words[1], reason: "low_confidence", phonemes: null, phoneme_score: null, break: "unexpected" },
    { ...ASSESSMENT.words[2], reason: null, phonemes: [{ ipa: "t", score: 0.9, heard: "t", quality: "good" }], phoneme_score: 0.9, break: null },
    { ...ASSESSMENT.words[3], reason: null, break: "missing" },
    { ...ASSESSMENT.words[4], reason: "substitution" },
    ASSESSMENT.words[5]
  ],
  scores: { accuracy: 0.75, completeness: 0.8333, fluency: 0.6, prosody: 0.42, overall: 0.7 },
  prosody: { score: 0.42, pitch_range_semitones: 1.4, monotone: true, unexpected_breaks: 1, missing_breaks: 1 },
  engines: { asr: "faster-whisper", phoneme: "wav2vec2" },
  deck: { added: 2, reviewed: 0 }
};

describe("AssessmentResult (phonemes and prosody)", () => {
  it("shows the phoneme detail with quality in text, expected × heard IPA and the reason", () => {
    const onPlayWord = vi.fn();
    render(wrap(<AssessmentResult assessment={PHONEME_ASSESSMENT} onPlayWord={onPlayWord} />));
    const word = screen.getByRole("button", { name: /Security/ });
    expect(word.getAttribute("title")).toContain(t("reading.result.reasons.phoneme"));
    fireEvent.click(word);
    const details = screen.getByRole("region", { name: t("reading.result.wordDetails") });
    const chips = within(details).getByRole("list", { name: t("reading.result.phonemesTitle") });
    const items = within(chips).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain(t("reading.result.phonemeQuality.good"));
    expect(items[1].textContent).toContain(t("reading.result.phonemeQuality.bad"));
    expect(items[1].textContent).toContain(t("reading.result.phonemeHeard", { heard: "/i/" }));
    expect(items[2].textContent).toContain(t("reading.result.phonemeQuality.fair"));
    expect(details.textContent).toContain("/sɪkjˈʊɹᵻɾi/");
    expect(details.textContent).toContain("/sɪkjʊɹɪti/");
    expect(details.textContent).toContain(t("reading.result.reasons.phoneme"));
    expect(details.textContent).toContain(t("reading.result.phonemeScore", { percent: 54 }));
    fireEvent.click(within(details).getByRole("button", { name: t("reading.result.playWord", { word: "Security" }) }));
    expect(onPlayWord).toHaveBeenCalledWith(expect.objectContaining({ index: 0 }));
    fireEvent.click(within(details).getByRole("button", { name: t("reading.result.closeDetails") }));
    expect(screen.queryByRole("region", { name: t("reading.result.wordDetails") })).toBeNull();
  });

  it("opens the detail of an ok word that has phonemes with the keyboard (it is a button)", () => {
    render(wrap(<AssessmentResult assessment={PHONEME_ASSESSMENT} />));
    const training = screen.getByRole("button", { name: /training/ });
    training.focus();
    fireEvent.click(training);
    expect(screen.getByRole("region", { name: t("reading.result.wordDetails") }).textContent).toContain("/t/");
  });

  it("adds the prosody meter, the monotone and pause notices, word pause marks and the deck notice", () => {
    render(wrap(<AssessmentResult assessment={PHONEME_ASSESSMENT} />));
    expect(screen.getAllByRole("meter")).toHaveLength(5);
    expect(screen.getByRole("meter", { name: t("reading.result.scores.prosody") })).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText(t("reading.result.monotone", { semitones: "1.4" }))).toBeTruthy();
    expect(screen.getByText(t("reading.result.unexpectedBreaks", { count: 1 }))).toBeTruthy();
    expect(screen.getByText(t("reading.result.missingBreaks", { count: 1 }))).toBeTruthy();
    expect(screen.getAllByText(t("reading.result.breakUnexpected")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("reading.result.breakMissing")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("reading.result.deckAddedOther", { count: 2 }))).toBeTruthy();
    expect(screen.getByRole("link", { name: t("reading.result.deckLink") }).getAttribute("href")).toBe("/read/words");
    expect(screen.queryByText(t("reading.result.phonemesOff"))).toBeNull();
    // A phoneme-reason mispronunciation does not repeat the "heard" word inline.
    expect(screen.getByRole("button", { name: /Security/ }).textContent).not.toContain(t("reading.result.heard", { heard: "security" }));
  });

  it("hides the prosody meter when the score is null", () => {
    render(wrap(<AssessmentResult assessment={{ ...PHONEME_ASSESSMENT, scores: { ...PHONEME_ASSESSMENT.scores, prosody: null }, prosody: null }} />));
    expect(screen.getAllByRole("meter")).toHaveLength(4);
    expect(screen.queryByText(t("reading.result.prosodyTitle"))).toBeNull();
  });
});
