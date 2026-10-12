import { describe, expect, it, vi } from "vitest";

import { fileExtensionForMime, pickRecorderMimeType, RECORDER_MIME_CANDIDATES } from "@/features/reading/lib/recorder";

describe("pickRecorderMimeType", () => {
  it("prefers Opus in WebM, then plain WebM, then MP4, then Ogg", () => {
    expect(RECORDER_MIME_CANDIDATES).toEqual(["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]);
    expect(pickRecorderMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMimeType((mime) => mime === "audio/webm")).toBe("audio/webm");
    // Safari: only MP4.
    expect(pickRecorderMimeType((mime) => mime === "audio/mp4")).toBe("audio/mp4");
    // Firefox (older): Ogg Opus only.
    expect(pickRecorderMimeType((mime) => mime.startsWith("audio/ogg"))).toBe("audio/ogg;codecs=opus");
  });

  it("asks the browser in order and returns null when nothing is supported", () => {
    const isTypeSupported = vi.fn((mime: string) => mime === "audio/mp4");
    expect(pickRecorderMimeType(isTypeSupported)).toBe("audio/mp4");
    expect(isTypeSupported.mock.calls.map(([mime]) => mime)).toEqual(["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]);
    expect(pickRecorderMimeType(() => false)).toBeNull();
    expect(pickRecorderMimeType(undefined)).toBeNull();
  });

  it("skips candidates the engine throws on", () => {
    const isTypeSupported = (mime: string) => {
      if (mime.includes("webm")) {
        throw new TypeError("unknown container");
      }
      return mime === "audio/ogg;codecs=opus";
    };
    expect(pickRecorderMimeType(isTypeSupported)).toBe("audio/ogg;codecs=opus");
  });
});

describe("fileExtensionForMime", () => {
  it("maps the container to the filename the API expects", () => {
    expect(fileExtensionForMime("audio/webm;codecs=opus")).toBe("webm");
    expect(fileExtensionForMime("audio/webm")).toBe("webm");
    expect(fileExtensionForMime("audio/mp4")).toBe("m4a");
    expect(fileExtensionForMime("audio/ogg;codecs=opus")).toBe("ogg");
    expect(fileExtensionForMime("")).toBe("webm");
  });
});
