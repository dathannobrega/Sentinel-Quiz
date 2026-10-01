/**
 * Word cloud (T08, CONTRATO-INCREMENTO-5.md §4–§7): input rules on the phone and a deterministic
 * layout for the projector. The layout is a plain Archimedean spiral with rectangle collision (no
 * dependency): the same words and counts always land in the same place, so the cloud only moves
 * when the data changes and every screen draws the same picture.
 */
import { WORD_MAX_LENGTH, type WordCloudWord } from "@/features/quiz-live/lib/protocol";

/** Mirrors the server's normalization (case, accents, spaces, trailing punctuation). */
export function normalizeWordKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?;:,]+$/, "")
    .trim()
    .slice(0, WORD_MAX_LENGTH);
}

/**
 * The words a person sends: trimmed, empty ones dropped, repeats (same key) counted once, at most
 * `max`. The server applies the same rule; doing it here keeps the "sent" view honest.
 */
export function cleanWords(inputs: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const input of inputs) {
    const word = input.replace(/\s+/g, " ").trim().slice(0, WORD_MAX_LENGTH);
    const key = normalizeWordKey(word);
    if (!word || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    words.push(word);
    if (words.length >= max) {
      break;
    }
  }
  return words;
}

export interface WordCloudBox {
  width: number;
  height: number;
}

export interface PlacedWord extends WordCloudWord {
  /** Centre of the word in the layout box (SVG user units). */
  x: number;
  y: number;
  fontSize: number;
  width: number;
  height: number;
  /** 0-based rank by count (0 = most sent): drives the colour. */
  rank: number;
}

export interface WordCloudLayoutOptions {
  minFontSize?: number;
  maxFontSize?: number;
  /** Width of `text` at `fontSize` (defaults to an estimate for bold sans-serif). */
  measure?: (text: string, fontSize: number) => number;
  padding?: number;
}

/** Average advance of a bold UI font, in em, per character (a little generous on purpose). */
const CHAR_EM = 0.6;
/** Global font scales tried in turn until every word fits (the largest scale that fits wins). */
const SCALES = [1, 0.85, 0.72, 0.6];
/** Share of the box the words may cover before the fonts are scaled down up front. */
const FILL_TARGET = 0.38;
const GRID_CELL = 64;
const GRID_STRIDE = 4096;

export function estimateTextWidth(text: string, fontSize: number): number {
  return Array.from(text).length * fontSize * CHAR_EM;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Placed rectangles bucketed by grid cell, so a collision test only looks at neighbours. */
class RectGrid {
  private readonly cells = new Map<number, Rect[]>();

  private keys(rect: Rect): number[] {
    const keys: number[] = [];
    for (let x = Math.floor(rect.left / GRID_CELL); x <= Math.floor(rect.right / GRID_CELL); x += 1) {
      for (let y = Math.floor(rect.top / GRID_CELL); y <= Math.floor(rect.bottom / GRID_CELL); y += 1) {
        keys.push(x * GRID_STRIDE + y);
      }
    }
    return keys;
  }

  collides(rect: Rect): boolean {
    for (const key of this.keys(rect)) {
      const bucket = this.cells.get(key);
      if (bucket && bucket.some((other) => overlaps(rect, other))) {
        return true;
      }
    }
    return false;
  }

  add(rect: Rect): void {
    for (const key of this.keys(rect)) {
      const bucket = this.cells.get(key);
      if (bucket) {
        bucket.push(rect);
      } else {
        this.cells.set(key, [rect]);
      }
    }
  }
}

/** Order used for the layout: most sent first, then alphabetical by key (stable across renders). */
export function sortWords(words: readonly WordCloudWord[]): WordCloudWord[] {
  return [...words].sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

interface ResolvedOptions {
  minFont: number;
  maxFont: number;
  measure: (text: string, fontSize: number) => number;
  padding: number;
}

/** One pass at a given font scale: each word walks an Archimedean spiral out from the centre. */
function fontSizeFor(word: WordCloudWord, top: number, bottom: number, minFont: number, maxFont: number): number {
  const weight = top === bottom ? 1 : Math.sqrt((word.n - bottom) / (top - bottom));
  return minFont + (maxFont - minFont) * weight;
}

/** Up-front scale so the words cover at most FILL_TARGET of the box (big rooms, many words). */
function fillScale(ordered: WordCloudWord[], box: WordCloudBox, options: ResolvedOptions): number {
  const top = ordered[0]?.n ?? 1;
  const bottom = ordered[ordered.length - 1]?.n ?? 1;
  let area = 0;
  for (const word of ordered) {
    const size = fontSizeFor(word, top, bottom, options.minFont, options.maxFont);
    area += (options.measure(word.text, size) + options.padding * 2) * (size * 1.05 + options.padding * 2);
  }
  const available = box.width * box.height * FILL_TARGET;
  return area > available ? Math.sqrt(available / area) : 1;
}

function placeAll(ordered: WordCloudWord[], box: WordCloudBox, options: ResolvedOptions, scale: number): PlacedWord[] {
  const minFont = options.minFont * scale;
  const maxFont = options.maxFont * scale;
  const { measure, padding } = options;
  const top = ordered[0]?.n ?? 1;
  const bottom = ordered[ordered.length - 1]?.n ?? 1;
  const cx = box.width / 2;
  const cy = box.height / 2;
  // Stretch the spiral to the box so a 16:9 cloud fills the width.
  const stretch = (box.width / Math.max(1, box.height)) * 0.8;
  const gap = Math.max(4, minFont * 0.4) / (2 * Math.PI);
  const stepLength = Math.max(3, minFont * 0.45);
  // Past this radius every spiral point is outside the box.
  const limit = Math.hypot(cx / stretch, cy);
  const grid = new RectGrid();
  const placed: PlacedWord[] = [];

  ordered.forEach((word, rank) => {
    let fontSize = fontSizeFor(word, top, bottom, minFont, maxFont);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const width = Math.min(measure(word.text, fontSize), box.width - padding * 2);
      const height = fontSize * 1.05;
      let angle = 0;
      let radius = 0;
      while (radius <= limit) {
        const x = cx + radius * Math.cos(angle) * stretch;
        const y = cy + radius * Math.sin(angle);
        const rect: Rect = { left: x - width / 2 - padding, right: x + width / 2 + padding, top: y - height / 2 - padding, bottom: y + height / 2 + padding };
        const inside = rect.left >= 0 && rect.top >= 0 && rect.right <= box.width && rect.bottom <= box.height;
        if (inside && !grid.collides(rect)) {
          grid.add(rect);
          placed.push({ ...word, x, y, fontSize, width, height, rank });
          return;
        }
        angle += Math.min(0.5, stepLength / Math.max(radius, stepLength));
        radius = gap * angle;
      }
      fontSize *= 0.8;
    }
  });
  return placed;
}

/**
 * Places the words from the centre outwards. Font size grows with the square root of the count
 * (area ∝ count). When some word does not fit, the whole cloud is retried at a smaller scale; a
 * word that still does not fit at the smallest scale is left out (it stays in the accessible list).
 */
export function layoutWordCloud(words: readonly WordCloudWord[], box: WordCloudBox, options: WordCloudLayoutOptions = {}): PlacedWord[] {
  const minFont = options.minFontSize ?? Math.max(10, box.height * 0.045);
  const resolved: ResolvedOptions = {
    minFont,
    maxFont: options.maxFontSize ?? Math.max(minFont, box.height * 0.2),
    measure: options.measure ?? estimateTextWidth,
    padding: options.padding ?? Math.max(2, box.height * 0.012)
  };
  const ordered = sortWords(words).filter((word) => word.n > 0 && word.text.trim());
  if (!ordered.length) {
    return [];
  }
  const base = fillScale(ordered, box, resolved);
  let best: PlacedWord[] = [];
  for (const scale of SCALES) {
    const placed = placeAll(ordered, box, resolved, base * scale);
    if (placed.length > best.length) {
      best = placed;
    }
    if (placed.length === ordered.length) {
      break;
    }
  }
  return best;
}
