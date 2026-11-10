import type { RecapInput } from '@orot/domain';

export interface RecapSlice {
  segmentId: string;
  transcriptId: string;
  revision: number;
  audioRange: { startMs: number; endMs: number };
  startOffset: number;
  endOffset: number;
  text: string;
}

export class RecapChunkBudgetError extends Error {}

/** Never invent word-level timestamps. Slices retain absolute UTF-16 offsets within their source segment. */
export function recapChunks(input: RecapInput): RecapSlice[][] {
  const slices: RecapSlice[] = [];
  for (const segment of [...input.segments].sort((a, b) => a.segmentOrdinal - b.segmentOrdinal)) {
    for (let startOffset = 0; startOffset < segment.text.length;) {
      let endOffset = Math.min(startOffset + 4000, segment.text.length);
      // Do not divide surrogate pairs; overlap preserves short questions/answers at a slice boundary.
      if (endOffset < segment.text.length && /[\uD800-\uDBFF]/.test(segment.text[endOffset - 1]))
        endOffset--;
      slices.push({
        segmentId: segment.id,
        transcriptId: segment.transcriptId,
        revision: segment.revision,
        audioRange: segment.audioRange,
        startOffset,
        endOffset,
        text: segment.text.slice(startOffset, endOffset),
      });
      // Sixty-four chunks hold at most eight slices each, even before overlap.
      if (slices.length > 512)
        throw new RecapChunkBudgetError('Recap transcript exceeds the bounded chunk budget.');
      if (endOffset === segment.text.length) break;
      startOffset = endOffset - 512;
      if (/[\uDC00-\uDFFF]/.test(segment.text[startOffset])) startOffset--;
    }
  }
  const chunks: RecapSlice[][] = [];
  let current: RecapSlice[] = [];
  let length = 0;
  for (const slice of slices) {
    if (current.length && (length + slice.text.length > 6000 || current.length === 8)) {
      chunks.push(current);
      // Adjacent segment context supports questions whose answer begins in the next chunk.
      const previous = current[current.length - 1];
      current = previous.text.length + slice.text.length <= 6000 ? [previous] : [];
      length = current.reduce((total, item) => total + item.text.length, 0);
    }
    current.push(slice);
    length += slice.text.length;
  }
  if (current.length) chunks.push(current);
  if (chunks.length > 64)
    throw new RecapChunkBudgetError('Recap transcript exceeds the bounded chunk budget.');
  return chunks;
}
