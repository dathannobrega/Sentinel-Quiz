import type { Page } from "@playwright/test";

import { expect, expectNoSeriousA11yViolations, registerViaUi, test } from "./fixtures";
import { t } from "./i18n";

/**
 * Sentinel Reader against the real API with SPEECH_PROVIDER=fake and AI_PROVIDER=fake, on the
 * synthetic book in e2e/fixtures/material/json (original text, not licensed material).
 *
 * The microphone is faked in the page: MediaRecorder yields a Blob whose bytes are
 * `FAKE:<transcript>` (the fake speech service reads it as the transcript; a word prefixed with
 * `~` is heard but badly pronounced). Set the transcript with `setTranscript` before recording.
 */

const BOOK_SLUG = "e2e_security_handbook";
const BOOK_TITLE = "E2E Security Handbook";
const PHISHING_SECTION = `${BOOK_SLUG}:c01:head-2-1`;
const READER_URL = `/read/s/${encodeURIComponent(PHISHING_SECTION)}`;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

const FAKE_MICROPHONE = `(() => {
  class FakeTrack { stop() {} }
  class FakeStream { getTracks() { return [new FakeTrack()]; } }
  class FakeMediaRecorder extends EventTarget {
    static isTypeSupported(type) { return String(type).startsWith("audio/webm"); }
    constructor(stream, options) {
      super();
      this.stream = stream;
      this.mimeType = (options && options.mimeType) || "audio/webm";
      this.state = "inactive";
    }
    start() { this.state = "recording"; }
    stop() {
      if (this.state === "inactive") { return; }
      this.state = "inactive";
      const event = new Event("dataavailable");
      event.data = new Blob(["FAKE:" + (window.__fakeTranscript || "")], { type: "audio/webm" });
      this.dispatchEvent(event);
      this.dispatchEvent(new Event("stop"));
    }
  }
  window.MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => new FakeStream() }
  });
})();`;

async function setTranscript(page: Page, transcript: string) {
  await page.evaluate((value) => {
    (window as unknown as { __fakeTranscript: string }).__fakeTranscript = value;
  }, transcript);
}

/** Records for a bit over the minimum duration (0.8 s) and stops. */
async function recordOnce(page: Page, recordName: string) {
  await page.getByRole("button", { name: recordName, exact: true }).click();
  const stop = page.getByRole("button", { name: t("reading.shadow.stop"), exact: true });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(1_100);
  await stop.click();
}

async function openReader(page: Page) {
  await page.goto(READER_URL);
  await expect(page.getByRole("heading", { level: 1, name: "Recognizing Phishing" })).toBeVisible();
}

function activeBlock(page: Page) {
  return page.locator('[role="group"][aria-current="true"]').first();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(FAKE_MICROPHONE);
});

test("library → chapter → section, then play the neural TTS", async ({ page }) => {
  await registerViaUi(page);
  await page.goto("/read");
  await expect(page.getByRole("heading", { level: 1, name: t("reading.library.title") })).toBeVisible();
  await page.getByRole("link", { name: BOOK_TITLE }).click();
  await page.waitForURL(`**/read/${BOOK_SLUG}`);

  await page.getByText(t("reading.book.chapterLabel", { index: 1 })).click();
  await page.getByRole("link", { name: "Recognizing Phishing" }).click();
  await page.waitForURL(`**${READER_URL}`);
  await expect(page.getByRole("heading", { level: 1, name: "Recognizing Phishing" })).toBeVisible();

  const tts = page.waitForResponse((response) => response.url().includes("/api/reading/sections/") && response.url().endsWith("/tts") && response.request().method() === "POST");
  await page.getByRole("button", { name: t("reading.player.play"), exact: true }).click();
  expect((await tts).ok()).toBe(true);
  await expect(page.getByRole("button", { name: t("reading.player.pause"), exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "reader");
});

test("shadowing marks a skipped and a mispronounced word, and the words review works", async ({ page }) => {
  await registerViaUi(page);
  await openReader(page);
  await page.getByRole("button", { name: t("reading.player.modeShadow"), exact: true }).click();

  const text = await activeBlock(page).locator("p").first().innerText();
  const words = text.match(WORD_PATTERN) ?? [];
  expect(words.length).toBeGreaterThan(8);
  const skipped = words[3];
  const mispronounced = words[5];
  const transcript = words
    .map((word, index) => (index === 3 ? null : index === 5 ? `~${word}` : word))
    .filter((word): word is string => word !== null)
    .join(" ");
  await setTranscript(page, transcript);
  await recordOnce(page, t("reading.shadow.record"));

  const result = page.getByRole("region", { name: t("reading.result.title") });
  await expect(result).toBeVisible({ timeout: 20_000 });
  const missedButton = result.getByRole("button", { name: new RegExp(skipped) }).first();
  await expect(missedButton).toHaveAttribute("title", new RegExp(t("reading.result.statusMissed")));
  const wrongButton = result.getByRole("button", { name: new RegExp(mispronounced) }).first();
  await expect(wrongButton).toHaveAttribute("title", new RegExp(t("reading.result.statusMispronounced")));
  await expect(result.getByText(/para sua revisão/)).toBeVisible();

  // The mispronounced word went to the spaced-repetition deck.
  await result.getByRole("link", { name: t("reading.result.deckLink") }).click();
  await page.waitForURL("**/read/words");
  await expect(page.getByRole("heading", { level: 1, name: t("reading.words.title") })).toBeVisible();
  await expect(page.getByText(mispronounced, { exact: true }).first()).toBeVisible();
  await expectNoSeriousA11yViolations(page, "words");

  await page.getByRole("button", { name: new RegExp(t("reading.words.reviewNow")) }).click();
  await expect(page.getByRole("region", { name: t("reading.words.session.title") })).toBeVisible();
  for (let card = 0; card < 10; card += 1) {
    if (await page.getByText(t("reading.words.session.doneTitle")).isVisible()) {
      break;
    }
    const progress = page.getByText(/^Cartão \d+ de \d+$/);
    await expect(progress).toBeVisible();
    const label = await progress.innerText();
    const record = page.getByRole("button", { name: t("reading.words.session.record"), exact: true });
    const reveal = page.getByRole("button", { name: t("reading.words.session.reveal"), exact: true });
    await expect(record.or(reveal)).toBeVisible();
    if (await record.isVisible()) {
      const word = (await page.locator("p.text-3xl").first().innerText()).trim();
      await setTranscript(page, word);
      await recordOnce(page, t("reading.words.session.record"));
      await expect(page.getByText(/^Avaliação: /)).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: new RegExp(t("reading.words.session.next")) }).click();
    } else {
      await reveal.click();
      await page.getByRole("button", { name: t("reading.words.grades.good"), exact: true }).click();
    }
    await expect(page.getByText(label, { exact: true })).toBeHidden();
  }
  await expect(page.getByText(t("reading.words.session.doneTitle"))).toBeVisible();
});

test("tap to translate opens the glossary and adds the word to the deck", async ({ page }) => {
  await registerViaUi(page);
  await openReader(page);
  const toggle = page.getByRole("button", { name: t("reading.player.glossaryTap"), exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await activeBlock(page).getByRole("button", { name: t("reading.glossary.openFor", { word: "sender" }) }).first().click();
  const dialog = page.getByRole("dialog", { name: /sender/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: new RegExp(t("reading.glossary.add")) }).click();
  await expect(dialog.getByText(t("reading.glossary.inDeck"))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.goto("/read/words");
  const row = page.getByRole("listitem").filter({ hasText: "sender" });
  await expect(row.first()).toBeVisible();
  await expect(row.first()).toContainText(t("reading.words.kinds.vocabulary"));
});

test("comprehension: generate the questions and answer one", async ({ page }) => {
  await registerViaUi(page);
  await openReader(page);
  const card = page.getByRole("region", { name: t("reading.quiz.title") });
  await card.getByRole("button", { name: new RegExp(t("reading.quiz.generate")) }).click();
  const firstQuestion = card.getByRole("group").first();
  await expect(firstQuestion).toBeVisible({ timeout: 20_000 });
  await firstQuestion.getByRole("radio").first().check();
  await card.getByRole("button", { name: t("reading.quiz.answer"), exact: true }).first().click();
  await expect(card.getByText(new RegExp(`${t("reading.quiz.correct")}|Incorreta`)).first()).toBeVisible();
  await expect(card.getByText(t("reading.quiz.evidence")).first()).toBeVisible();
});

test("your data: export as JSON and delete everything", async ({ page }) => {
  await registerViaUi(page);
  await page.goto("/read");
  await expect(page.getByRole("heading", { name: t("reading.data.title") })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: new RegExp(t("reading.data.export").replace(/[()]/g, "\\$&")) }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sentinel-reading-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  const payload = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  expect(payload).toHaveProperty("exported_at");
  expect(payload).toHaveProperty("words");

  await page.getByRole("button", { name: t("reading.data.delete"), exact: true }).click();
  const dialog = page.getByRole("dialog", { name: t("reading.data.deleteTitle") });
  await dialog.getByRole("button", { name: t("reading.data.deleteConfirm"), exact: true }).click();
  await expect(page.getByText(/Dados apagados/)).toBeVisible();
});

test("sentence drill: a good reading passes and moves to the next sentence", async ({ page }) => {
  await registerViaUi(page);
  await openReader(page);
  await page.getByRole("button", { name: t("reading.player.modeDrill"), exact: true }).click();
  const panel = page.getByRole("region", { name: t("reading.drill.title") });
  await expect(panel.getByText(/^Frase 1 de \d+$/)).toBeVisible();
  const sentence = await panel.locator("blockquote").innerText();
  await setTranscript(page, (sentence.match(WORD_PATTERN) ?? []).join(" "));
  await recordOnce(page, t("reading.drill.record"));
  await expect(panel.getByText(t("reading.drill.passed"))).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/^Frase 2 de \d+$/)).toBeVisible();
});

test("offline: download a chapter and play it from Cache Storage without the API", async ({ page }) => {
  await registerViaUi(page);
  await page.goto(`/read/${BOOK_SLUG}`);
  await page.getByText(t("reading.book.chapterLabel", { index: 1 })).click();
  await page.getByRole("button", { name: t("reading.offline.download") }).click();
  await expect(page.getByText(t("reading.offline.downloaded"))).toBeVisible({ timeout: 30_000 });

  // From here on the reading API is unreachable: the offline reader must not need it.
  const apiCalls: string[] = [];
  await page.route("**/api/reading/**", (route) => {
    apiCalls.push(route.request().url());
    return route.abort();
  });
  await page.goto("/read/offline");
  await expect(page.getByRole("heading", { level: 1, name: t("reading.offline.pageTitle") })).toBeVisible();
  await page.getByRole("button", { name: t("reading.offline.playSection", { section: "Pretexting on the Phone" }) }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pretexting on the Phone" })).toBeVisible();
  await page.getByRole("button", { name: t("reading.player.play"), exact: true }).click();
  await expect(page.getByRole("button", { name: t("reading.player.pause"), exact: true })).toBeVisible();
  expect(apiCalls).toEqual([]);
});

