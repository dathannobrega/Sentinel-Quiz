/**
 * Browser fallback for the neural TTS: `speechSynthesis` with a voice in the book's language
 * (English by default). Word highlighting comes from `onboundary` (charIndex into the spoken
 * text); not every engine fires it.
 */

import type { ReadingLanguage } from "@/types/api";

export interface SpeakOptions {
  text: string;
  /** 0.5–1.5 (same scale as the TTS speed). */
  rate: number;
  /** BCP 47 tag of the text (default `en-US`). */
  lang?: string;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
  onError?: (error: SpeechSynthesisErrorEvent) => void;
}

export interface SpeechHandle {
  cancel(): void;
  pause(): void;
  resume(): void;
}

export function isWebSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** `speechSynthesis` language tag for a detected book language (English when unknown). */
export function speechLangFor(language: ReadingLanguage | null | undefined): string {
  switch (language) {
    case "pt":
      return "pt-BR";
    case "es":
      return "es-ES";
    default:
      return "en-US";
  }
}

function normalizeTag(tag: string): string {
  return tag.replace("_", "-").toLowerCase();
}

/**
 * Best voice for `lang`: an exact local match first, then any exact match, then a local voice of
 * the same language, then any voice of that language, then the default voice.
 */
export function pickVoiceForLang(lang: string, voices: SpeechSynthesisVoice[] = readVoices()): SpeechSynthesisVoice | null {
  const wanted = normalizeTag(lang);
  const primary = wanted.split("-")[0];
  const sameLanguage = voices.filter((voice) => normalizeTag(voice.lang).split("-")[0] === primary);
  const prefer = (predicate: (voice: SpeechSynthesisVoice) => boolean) => sameLanguage.find(predicate) ?? null;
  return (
    prefer((voice) => normalizeTag(voice.lang) === wanted && voice.localService) ??
    prefer((voice) => normalizeTag(voice.lang) === wanted) ??
    prefer((voice) => voice.localService) ??
    sameLanguage[0] ??
    voices.find((voice) => voice.default) ??
    null
  );
}

/** Best English voice available: local en-US first, then any en-*, then the default voice. */
export function pickEnglishVoice(voices: SpeechSynthesisVoice[] = readVoices()): SpeechSynthesisVoice | null {
  return pickVoiceForLang("en-US", voices);
}

function readVoices(): SpeechSynthesisVoice[] {
  if (!isWebSpeechSupported()) {
    return [];
  }
  try {
    return window.speechSynthesis.getVoices();
  } catch {
    return [];
  }
}

/** Speaks `text`, cancelling anything already queued. Returns a handle to stop it. */
export function speak(options: SpeakOptions): SpeechHandle {
  const synth = window.speechSynthesis;
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(options.text);
  const lang = options.lang ?? "en-US";
  utterance.lang = lang;
  utterance.rate = Math.min(1.5, Math.max(0.5, options.rate));
  const voice = pickVoiceForLang(lang);
  if (voice) {
    utterance.voice = voice;
  }
  let finished = false;
  utterance.onboundary = (event) => {
    if (event.name === "word" || event.name === undefined) {
      options.onBoundary?.(event.charIndex);
    }
  };
  utterance.onend = () => {
    if (!finished) {
      finished = true;
      options.onEnd?.();
    }
  };
  utterance.onerror = (event) => {
    if (finished) {
      return;
    }
    finished = true;
    // `interrupted`/`canceled` are the normal outcome of cancel(): not an error for the caller.
    if (event.error === "interrupted" || event.error === "canceled") {
      return;
    }
    options.onError?.(event);
  };

  synth.speak(utterance);

  return {
    cancel() {
      finished = true;
      synth.cancel();
    },
    pause() {
      synth.pause();
    },
    resume() {
      synth.resume();
    }
  };
}
