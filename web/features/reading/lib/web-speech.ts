/**
 * Browser fallback for the neural TTS: `speechSynthesis` with an English voice. Word highlighting
 * comes from `onboundary` (charIndex into the spoken text); not every engine fires it.
 */

export interface SpeakOptions {
  text: string;
  /** 0.5–1.5 (same scale as the TTS speed). */
  rate: number;
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

/** Best English voice available: local en-US first, then any en-*, then the default voice. */
export function pickEnglishVoice(voices: SpeechSynthesisVoice[] = readVoices()): SpeechSynthesisVoice | null {
  const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang));
  const prefer = (predicate: (voice: SpeechSynthesisVoice) => boolean) => english.find(predicate) ?? null;
  return (
    prefer((voice) => /^en[-_]US$/i.test(voice.lang) && voice.localService) ??
    prefer((voice) => /^en[-_]US$/i.test(voice.lang)) ??
    prefer((voice) => voice.localService) ??
    english[0] ??
    voices.find((voice) => voice.default) ??
    null
  );
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
  utterance.lang = "en-US";
  utterance.rate = Math.min(1.5, Math.max(0.5, options.rate));
  const voice = pickEnglishVoice();
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
