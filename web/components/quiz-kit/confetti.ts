/**
 * canvas-confetti wrapper (lazy-loaded, reduced-motion aware, worker-backed canvas).
 * Colours come from the active live theme (`--lq-answer-*`). The CSP already allows `worker-src blob:`.
 */
import type { CreateTypes, Options } from "canvas-confetti";

export type ConfettiKind = "burst" | "sides" | "fireworks";

let instance: CreateTypes | null = null;
let canvas: HTMLCanvasElement | null = null;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function themeColors(scope?: Element | null): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const element = scope ?? document.querySelector("[data-lq-theme]") ?? document.documentElement;
  const styles = window.getComputedStyle(element);
  return [1, 2, 3, 4, 5, 6]
    .map((index) => styles.getPropertyValue(`--lq-answer-${index}`).trim())
    .filter(Boolean);
}

async function getInstance(): Promise<CreateTypes | null> {
  if (typeof document === "undefined") {
    return null;
  }
  if (instance && canvas?.isConnected) {
    return instance;
  }
  const { default: confetti } = await import("canvas-confetti");
  canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "60"
  });
  document.body.appendChild(canvas);
  let useWorker = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
  try {
    instance = confetti.create(canvas, { resize: true, useWorker, disableForReducedMotion: true });
  } catch {
    useWorker = false;
    instance = confetti.create(canvas, { resize: true, useWorker, disableForReducedMotion: true });
  }
  return instance;
}

/**
 * Fires a celebration. No-op under reduced motion or calm mode (callers show a static badge
 * instead). Resolves when the animation finishes.
 */
export async function fireConfetti(kind: ConfettiKind, options: { calm?: boolean; scope?: Element | null } = {}): Promise<void> {
  if (options.calm || prefersReducedMotion()) {
    return;
  }
  const shoot = await getInstance();
  if (!shoot) {
    return;
  }
  const colors = themeColors(options.scope);
  const base: Options = { colors: colors.length ? colors : undefined, disableForReducedMotion: true, ticks: 220, scalar: 1.05 };

  if (kind === "burst") {
    await shoot({ ...base, particleCount: 120, spread: 80, startVelocity: 48, origin: { x: 0.5, y: 0.62 } });
    return;
  }
  if (kind === "sides") {
    await Promise.all([
      shoot({ ...base, particleCount: 90, angle: 60, spread: 60, startVelocity: 62, origin: { x: 0, y: 0.78 } }),
      shoot({ ...base, particleCount: 90, angle: 120, spread: 60, startVelocity: 62, origin: { x: 1, y: 0.78 } })
    ]);
    return;
  }
  const bursts = [
    { x: 0.3, y: 0.3 },
    { x: 0.7, y: 0.25 },
    { x: 0.5, y: 0.2 }
  ];
  for (const origin of bursts) {
    void shoot({ ...base, particleCount: 70, spread: 360, startVelocity: 30, gravity: 0.7, decay: 0.92, origin, shapes: ["star", "circle"] });
    await new Promise((resolve) => setTimeout(resolve, 380));
  }
}

/** Removes the shared canvas (on unmount of the celebrating screen). */
export function resetConfetti(): void {
  instance?.reset();
  canvas?.remove();
  instance = null;
  canvas = null;
}
