import { describe, expect, it, vi } from "vitest";

import { createClipPlayer } from "@/features/reading/lib/clip-player";

class FakeAudio extends EventTarget {
  src = "";
  preload = "";
  currentTime = 0;
  paused = true;
  readyState = 1;
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}

describe("clip player", () => {
  it("plays a word range of the recording and stops at its end", async () => {
    const audio = new FakeAudio();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:recording", revokeObjectURL: vi.fn() });
    const player = createClipPlayer(() => audio as unknown as HTMLAudioElement);
    const blob = new Blob(["x"]);
    const done = player.play(blob, 1.0, 1.5);
    expect(audio.src).toBe("blob:recording");
    expect(audio.currentTime).toBeCloseTo(0.95, 2);
    expect(audio.paused).toBe(false);
    audio.currentTime = 1.3;
    audio.dispatchEvent(new Event("timeupdate"));
    expect(audio.paused).toBe(false);
    audio.currentTime = 1.7;
    audio.dispatchEvent(new Event("timeupdate"));
    await done;
    expect(audio.paused).toBe(true);
    // Same blob: the object URL is reused.
    void player.play(blob, 0, 0.3);
    expect(audio.src).toBe("blob:recording");
    player.dispose();
    vi.unstubAllGlobals();
  });
});
