/**
 * NDJSON (one JSON object per line) parsing for the streamed TTS. Framework-free: the byte
 * decoder keeps a text buffer across chunks, so a line split over two chunks (or a multi-byte
 * character split over two chunks) is reassembled. CRLF and blank lines are tolerated.
 */

import type { ReadingStreamLine } from "@/types/api";

export interface NdjsonParser {
  /** Feeds raw bytes; returns the complete lines that ended inside this chunk (without the newline). */
  push(chunk: Uint8Array): string[];
  /** Returns the trailing line without a newline (end of body), if any. */
  flush(): string[];
}

export function createNdjsonParser(): NdjsonParser {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const splitLines = (): string[] => {
    const lines: string[] = [];
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line.trim()) {
        lines.push(line);
      }
      index = buffer.indexOf("\n");
    }
    return lines;
  };

  return {
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      return splitLines();
    },
    flush() {
      buffer += decoder.decode();
      const lines = splitLines();
      const rest = buffer.replace(/\r$/, "");
      buffer = "";
      if (rest.trim()) {
        lines.push(rest);
      }
      return lines;
    }
  };
}

export class StreamLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamLineError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses one NDJSON line of `GET …/tts/stream`; throws StreamLineError on malformed input. */
export function parseStreamLine(line: string): ReadingStreamLine {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new StreamLineError("invalid JSON line");
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new StreamLineError("line without a type");
  }
  switch (value.type) {
    case "meta":
      if (typeof value.text !== "string") {
        throw new StreamLineError("meta without text");
      }
      return value as unknown as ReadingStreamLine;
    case "segment":
      if (typeof value.index !== "number" || typeof value.audio_url !== "string" || !Array.isArray(value.words)) {
        throw new StreamLineError("segment without index, audio_url or words");
      }
      return value as unknown as ReadingStreamLine;
    case "done":
      return {
        type: "done",
        duration_seconds: typeof value.duration_seconds === "number" ? value.duration_seconds : 0
      };
    case "error":
      return {
        type: "error",
        code: typeof value.code === "string" ? value.code : "tts_failed",
        message: typeof value.message === "string" ? value.message : ""
      };
    default:
      throw new StreamLineError(`unknown line type ${value.type}`);
  }
}

/**
 * Reads a response body as parsed stream lines. The reader is cancelled when `signal` aborts (the
 * fetch's own abort only covers the headers), which rejects the pending read with an AbortError.
 */
export async function* readStreamLines(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<ReadingStreamLine> {
  const reader = body.getReader();
  const parser = createNdjsonParser();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  if (signal?.aborted) {
    onAbort();
    throw new DOMException("stream aborted", "AbortError");
  }
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (signal?.aborted) {
        throw new DOMException("stream aborted", "AbortError");
      }
      const lines = done ? parser.flush() : value ? parser.push(value) : [];
      for (const line of lines) {
        yield parseStreamLine(line);
      }
      if (done) {
        return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
