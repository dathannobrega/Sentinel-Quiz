import { tokenizeDisplay, type DisplayToken } from "@/features/reading/lib/tokenize";
import type { ReadingSectionDetail } from "@/types/api";

/** One paragraph of the section: the unit of TTS, shadowing and progress. */
export interface ReaderBlock {
  key: string;
  partId: string;
  partTitle: string;
  partDepth: number;
  /** True for the first block of a part after the first (renders the part heading above it). */
  startsPart: boolean;
  blockIndex: number;
  text: string;
  label: string | null;
  tokens: DisplayToken[];
}

export function blockKey(partId: string, blockIndex: number): string {
  return `${partId}#${blockIndex}`;
}

/** Flattens `parts[].blocks[]` in reading order, tokenizing each block once. */
export function flattenBlocks(detail: ReadingSectionDetail): ReaderBlock[] {
  const blocks: ReaderBlock[] = [];
  detail.parts.forEach((part, partIndex) => {
    part.blocks.forEach((block, blockIndex) => {
      blocks.push({
        key: blockKey(part.id, blockIndex),
        partId: part.id,
        partTitle: part.title,
        partDepth: part.depth,
        startsPart: partIndex > 0 && blockIndex === 0,
        blockIndex,
        text: block.text,
        label: block.label ?? null,
        tokens: tokenizeDisplay(block.text)
      });
    });
  });
  return blocks;
}

/** Index of the saved progress position in the flattened list (0 when unknown or stale). */
export function findBlockIndex(blocks: readonly ReaderBlock[], partId: string | null | undefined, blockIndex: number | null | undefined): number {
  if (!partId || blockIndex === null || blockIndex === undefined) {
    return 0;
  }
  const found = blocks.findIndex((block) => block.partId === partId && block.blockIndex === blockIndex);
  return found >= 0 ? found : 0;
}
