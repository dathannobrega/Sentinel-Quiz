import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bindMediaSession, setMediaPlaybackState, setMediaPosition } from "@/features/reading/lib/media-session";

type Handler = ((details: { action: string; seekOffset?: number }) => void) | null;

class FakeMediaMetadata {
  title: string;
  artist: string;
  album: string;
  constructor(init: { title: string; artist: string; album: string }) {
    this.title = init.title;
    this.artist = init.artist;
    this.album = init.album;
  }
}

function installMediaSession() {
  const handlers = new Map<string, Handler>();
  const session = {
    metadata: null as FakeMediaMetadata | null,
    playbackState: "none",
    setActionHandler: vi.fn((action: string, handler: Handler) => {
      handlers.set(action, handler);
    }),
    setPositionState: vi.fn()
  };
  vi.stubGlobal("navigator", { mediaSession: session });
  vi.stubGlobal("MediaMetadata", FakeMediaMetadata);
  return { session, handlers };
}

describe("media session", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets the metadata and wires play/pause, tracks and ±10 s seeks", () => {
    const { session, handlers } = installMediaSession();
    const callbacks = { play: vi.fn(), pause: vi.fn(), previous: vi.fn(), next: vi.fn(), seekBy: vi.fn() };
    const cleanup = bindMediaSession({ title: "Phishing", artist: "Fake Security Guide", album: "Chapter 1" }, callbacks);
    expect(session.metadata).toMatchObject({ title: "Phishing", artist: "Fake Security Guide", album: "Chapter 1" });

    handlers.get("play")?.({ action: "play" });
    handlers.get("pause")?.({ action: "pause" });
    handlers.get("previoustrack")?.({ action: "previoustrack" });
    handlers.get("nexttrack")?.({ action: "nexttrack" });
    handlers.get("seekbackward")?.({ action: "seekbackward" });
    handlers.get("seekforward")?.({ action: "seekforward", seekOffset: 5 });
    expect(callbacks.play).toHaveBeenCalledTimes(1);
    expect(callbacks.pause).toHaveBeenCalledTimes(1);
    expect(callbacks.previous).toHaveBeenCalledTimes(1);
    expect(callbacks.next).toHaveBeenCalledTimes(1);
    expect(callbacks.seekBy).toHaveBeenNthCalledWith(1, -10);
    expect(callbacks.seekBy).toHaveBeenNthCalledWith(2, 5);

    cleanup();
    expect([...handlers.values()].every((handler) => handler === null)).toBe(true);
  });

  it("updates the playback and position state, ignoring an unknown duration", () => {
    const { session } = installMediaSession();
    setMediaPlaybackState("playing");
    expect(session.playbackState).toBe("playing");
    setMediaPosition(0, 1);
    expect(session.setPositionState).not.toHaveBeenCalled();
    setMediaPosition(30, 42, 1.25);
    expect(session.setPositionState).toHaveBeenCalledWith({ duration: 30, position: 30, playbackRate: 1.25 });
  });

  it("is a no-op without the API", () => {
    vi.stubGlobal("navigator", {});
    expect(() => bindMediaSession({ title: "a", artist: "b", album: "c" }, { play: vi.fn(), pause: vi.fn(), previous: vi.fn(), next: vi.fn(), seekBy: vi.fn() })()).not.toThrow();
    expect(() => setMediaPosition(10, 1)).not.toThrow();
  });
});
