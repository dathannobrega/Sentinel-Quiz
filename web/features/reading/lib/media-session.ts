/**
 * Media Session wiring (lock screen / headset controls): metadata, play/pause, previous/next block,
 * ±10 s seek and the position state. Every call is a no-op where the API is missing.
 */

export interface MediaSessionMetadataInput {
  /** Section title. */
  title: string;
  /** Book title. */
  artist: string;
  /** Chapter title. */
  album: string;
}

export interface MediaSessionHandlers {
  play: () => void;
  pause: () => void;
  previous: () => void;
  next: () => void;
  /** Relative seek in seconds (negative = back). */
  seekBy: (seconds: number) => void;
}

export const MEDIA_SEEK_SECONDS = 10;

const ACTIONS: MediaSessionAction[] = ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward"];

function session(): MediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !navigator.mediaSession) {
    return null;
  }
  return navigator.mediaSession;
}

export function isMediaSessionSupported(): boolean {
  return session() !== null;
}

/** Sets metadata and action handlers; returns a cleanup that removes the handlers. */
export function bindMediaSession(metadata: MediaSessionMetadataInput, handlers: MediaSessionHandlers): () => void {
  const media = session();
  if (!media) {
    return () => {};
  }
  if (typeof MediaMetadata !== "undefined") {
    media.metadata = new MediaMetadata({ title: metadata.title, artist: metadata.artist, album: metadata.album });
  }
  const table: Record<string, MediaSessionActionHandler> = {
    play: () => handlers.play(),
    pause: () => handlers.pause(),
    previoustrack: () => handlers.previous(),
    nexttrack: () => handlers.next(),
    seekbackward: (details) => handlers.seekBy(-(details.seekOffset ?? MEDIA_SEEK_SECONDS)),
    seekforward: (details) => handlers.seekBy(details.seekOffset ?? MEDIA_SEEK_SECONDS)
  };
  for (const action of ACTIONS) {
    try {
      media.setActionHandler(action, table[action]);
    } catch {
      // Unsupported action in this browser.
    }
  }
  return () => {
    for (const action of ACTIONS) {
      try {
        media.setActionHandler(action, null);
      } catch {
        // Ignore.
      }
    }
  };
}

export function setMediaPlaybackState(state: MediaSessionPlaybackState): void {
  const media = session();
  if (media) {
    media.playbackState = state;
  }
}

/** Updates the lock-screen scrubber; ignores invalid values (duration unknown, position past the end). */
export function setMediaPosition(duration: number, position: number, playbackRate = 1): void {
  const media = session();
  if (!media || typeof media.setPositionState !== "function") {
    return;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }
  try {
    media.setPositionState({ duration, position: Math.min(Math.max(0, position), duration), playbackRate: playbackRate > 0 ? playbackRate : 1 });
  } catch {
    // Some engines reject transient states (e.g. while loading).
  }
}
