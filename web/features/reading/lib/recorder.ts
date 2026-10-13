/**
 * Microphone recording for shadowing: MediaRecorder with the first supported Opus/AAC container,
 * 32 kb/s, and a hard stop at `maxSeconds`. The audio never leaves memory except for the upload.
 */

import { repeatRecordingCapSeconds, startSilenceDetector, type SilenceDetectorHandle } from "@/features/reading/lib/silence-detector";

export const RECORDER_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"] as const;
export const RECORDER_BITS_PER_SECOND = 32_000;
export const MAX_RECORDING_SECONDS = 90;

export type RecorderErrorCode = "unsupported" | "permission_denied" | "no_device" | "failed";

export class RecorderError extends Error {
  code: RecorderErrorCode;

  constructor(code: RecorderErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RecorderError";
    this.code = code;
  }
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  /** `recording.webm` | `recording.m4a` | `recording.ogg`, matching the container. */
  filename: string;
  durationSeconds: number;
  /** True when the recorder hit the hard limit. */
  hitLimit: boolean;
  /** True when the silence detector ended the recording. */
  stoppedBySilence: boolean;
}

export interface ActiveRecording {
  mimeType: string;
  /** Resolves when the recording stops (manually or at the limit). */
  result: Promise<RecordingResult>;
  stop(): void;
  /** Stops and releases the microphone without producing a result (the promise rejects). */
  cancel(): void;
}

export interface StartRecordingOptions {
  maxSeconds?: number;
  /** Called about every 250 ms with the elapsed seconds. */
  onElapsed?: (seconds: number) => void;
  /**
   * Stop by itself after 1.2 s of silence once voice was heard ("listen and repeat"). Without the
   * Web Audio API the recording only stops at `maxSeconds`.
   */
  stopOnSilence?: boolean;
}

export { repeatRecordingCapSeconds };

type IsTypeSupported = (mimeType: string) => boolean;

/** True when this browser can capture and encode microphone audio. */
export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** First candidate the browser can encode, in preference order (Opus/WebM first); null when none. */
export function pickRecorderMimeType(
  isTypeSupported: IsTypeSupported | undefined = typeof MediaRecorder !== "undefined"
    ? (mime) => MediaRecorder.isTypeSupported(mime)
    : undefined
): string | null {
  if (!isTypeSupported) {
    return null;
  }
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) {
        return candidate;
      }
    } catch {
      // Some engines throw on unknown containers; try the next one.
    }
  }
  return null;
}

/** File extension the API recognises for a recorder container. */
export function fileExtensionForMime(mimeType: string): "webm" | "m4a" | "ogg" {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4" || base === "video/mp4") {
    return "m4a";
  }
  if (base === "audio/ogg") {
    return "ogg";
  }
  return "webm";
}

function toRecorderError(error: unknown): RecorderError {
  if (error instanceof RecorderError) {
    return error;
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new RecorderError("permission_denied", name);
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return new RecorderError("no_device", name);
  }
  return new RecorderError("failed", error instanceof Error ? error.message : String(error));
}

/**
 * Asks for the microphone and starts recording. Rejects with a RecorderError (`unsupported`,
 * `permission_denied`, `no_device`, `failed`).
 */
export async function startRecording(options: StartRecordingOptions = {}): Promise<ActiveRecording> {
  if (!isRecordingSupported()) {
    throw new RecorderError("unsupported");
  }
  const mimeType = pickRecorderMimeType();
  if (!mimeType) {
    throw new RecorderError("unsupported", "no supported container");
  }
  const maxSeconds = options.maxSeconds ?? MAX_RECORDING_SECONDS;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
  } catch (error) {
    throw toRecorderError(error);
  }

  const releaseTracks = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: RECORDER_BITS_PER_SECOND });
  } catch (error) {
    releaseTracks();
    throw toRecorderError(error);
  }

  const chunks: Blob[] = [];
  const startedAt = performance.now();
  let hitLimit = false;
  let stoppedBySilence = false;
  let cancelled = false;
  let settled = false;
  let silence: SilenceDetectorHandle | null = null;

  let resolveResult: (value: RecordingResult) => void = () => {};
  let rejectResult: (reason: RecorderError) => void = () => {};
  const result = new Promise<RecordingResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const elapsedSeconds = () => (performance.now() - startedAt) / 1000;

  const ticker = globalThis.setInterval(() => {
    const elapsed = elapsedSeconds();
    options.onElapsed?.(Math.min(elapsed, maxSeconds));
    if (elapsed >= maxSeconds && recorder.state === "recording") {
      hitLimit = true;
      recorder.stop();
    }
  }, 250);

  const finish = () => {
    globalThis.clearInterval(ticker);
    silence?.stop();
    silence = null;
    releaseTracks();
  };

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });
  recorder.addEventListener("error", () => {
    if (settled) {
      return;
    }
    settled = true;
    finish();
    rejectResult(new RecorderError("failed", "recorder error"));
  });
  recorder.addEventListener("stop", () => {
    if (settled) {
      return;
    }
    settled = true;
    finish();
    if (cancelled) {
      rejectResult(new RecorderError("failed", "cancelled"));
      return;
    }
    const type = recorder.mimeType || mimeType;
    resolveResult({
      blob: new Blob(chunks, { type }),
      mimeType: type,
      filename: `recording.${fileExtensionForMime(type)}`,
      durationSeconds: Math.min(elapsedSeconds(), maxSeconds),
      hitLimit,
      stoppedBySilence
    });
  });

  try {
    recorder.start(1000);
  } catch (error) {
    finish();
    throw toRecorderError(error);
  }

  if (options.stopOnSilence) {
    silence = startSilenceDetector(stream, { maxMs: maxSeconds * 1000 }, () => {
      if (recorder.state === "recording") {
        stoppedBySilence = true;
        recorder.stop();
      }
    });
  }

  return {
    mimeType,
    result,
    stop() {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    },
    cancel() {
      cancelled = true;
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else if (!settled) {
        settled = true;
        finish();
        rejectResult(new RecorderError("failed", "cancelled"));
      }
    }
  };
}
