/**
 * Plays a time range of a recording the learner just made (kept only in the browser's memory).
 * One shared HTMLAudioElement; the object URL is created per blob and revoked when replaced.
 * Used by the practice panels for "listen to my recording" of a word or a sentence, so the
 * learner can compare their own sound with the model's.
 */

export interface ClipPlayer {
  /** Plays `blob` from `start` to `end` (seconds). Resolves when the range ends or is interrupted. */
  play(blob: Blob, start: number, end: number): Promise<void>;
  stop(): void;
  dispose(): void;
}

// Whisper word ends tend to come early; a little tail keeps the last consonant audible.
const TAIL_SECONDS = 0.12;
const LEAD_SECONDS = 0.05;

export function createClipPlayer(createAudio: () => HTMLAudioElement = () => new Audio()): ClipPlayer {
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let urlBlob: Blob | null = null;
  let cleanup: (() => void) | null = null;

  function ensureAudio(): HTMLAudioElement {
    if (!audio) {
      audio = createAudio();
      audio.preload = "auto";
    }
    return audio;
  }

  function stop() {
    cleanup?.();
    cleanup = null;
    if (audio && !audio.paused) {
      audio.pause();
    }
  }

  return {
    play(blob, start, end) {
      stop();
      const element = ensureAudio();
      if (urlBlob !== blob) {
        if (url) {
          URL.revokeObjectURL(url);
        }
        url = URL.createObjectURL(blob);
        urlBlob = blob;
        element.src = url;
      }
      const from = Math.max(0, start - LEAD_SECONDS);
      const to = Math.max(from + 0.1, end + TAIL_SECONDS);
      return new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) {
            return;
          }
          finished = true;
          element.removeEventListener("timeupdate", onTime);
          element.removeEventListener("ended", finish);
          element.removeEventListener("pause", finish);
          element.removeEventListener("error", finish);
          if (!element.paused) {
            element.pause();
          }
          cleanup = null;
          resolve();
        };
        const onTime = () => {
          if (element.currentTime >= to) {
            finish();
          }
        };
        cleanup = finish;
        element.addEventListener("timeupdate", onTime);
        element.addEventListener("ended", finish);
        element.addEventListener("pause", finish);
        element.addEventListener("error", finish);
        const begin = () => {
          element.currentTime = from;
          void element.play().catch(finish);
        };
        if (element.readyState >= 1) {
          begin();
        } else {
          element.addEventListener("loadedmetadata", begin, { once: true });
        }
      });
    },
    stop,
    dispose() {
      stop();
      if (url) {
        URL.revokeObjectURL(url);
        url = null;
        urlBlob = null;
      }
      audio = null;
    }
  };
}
