import type { RecapEvidence, RecapInput } from '@orot/domain';
import { RecapChunkBudgetError } from './chunks';

export interface RecapUnit {
  ref: string;
  segmentId: string;
  transcriptId: string;
  revision: number;
  audioRange: { startMs: number; endMs: number };
  startOffset: number;
  endOffset: number;
  text: string;
}

/** Units are source text fragments, not authenticated speaker turns or word timestamps. */
export function recapUnits(input: RecapInput): RecapUnit[] {
  const units: RecapUnit[] = [];
  for (const segment of [...input.segments].sort((a, b) => a.segmentOrdinal - b.segmentOrdinal)) {
    let startOffset = 0;
    while (startOffset < segment.text.length) {
      let endOffset = Math.min(startOffset + 512, segment.text.length);
      if (endOffset < segment.text.length && /[\uD800-\uDBFF]/.test(segment.text[endOffset - 1]))
        endOffset--;
      const part = segment.text.slice(startOffset, endOffset);
      const boundary = part.search(/[.!?。！？\n]/);
      if (boundary >= 0) endOffset = startOffset + boundary + 1;
      units.push({
        ref: `u${units.length}`,
        segmentId: segment.id,
        transcriptId: segment.transcriptId,
        revision: segment.revision,
        audioRange: segment.audioRange,
        startOffset,
        endOffset,
        text: segment.text.slice(startOffset, endOffset),
      });
      if (units.length > 1024) throw new RecapChunkBudgetError('Recap unit budget exceeded.');
      startOffset = endOffset;
    }
  }
  return units;
}

/** Group bounded units with one-unit overlap for adjacent question/answer context. */
export function recapUnitChunks(units: readonly RecapUnit[]): RecapUnit[][] {
  const chunks: RecapUnit[][] = [];
  let current: RecapUnit[] = [];
  let length = 0;
  for (const unit of units) {
    if (current.length && (current.length >= 16 || length + unit.text.length > 6000)) {
      chunks.push(current);
      const last = current[current.length - 1];
      current = [last];
      length = last.text.length;
    }
    current.push(unit);
    length += unit.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Resolve only a supplied reference against its original current source, never search for matching text. */
export function resolveRecapUnit(
  input: RecapInput,
  allowed: readonly RecapUnit[],
  ref: string,
): RecapEvidence {
  const matches = allowed.filter((unit) => unit.ref === ref);
  if (matches.length !== 1) throw new Error('Unknown or ambiguous Recap unit.');
  const unit = matches[0];
  const segment = input.segments.find((item) => item.id === unit.segmentId);
  if (
    !segment ||
    segment.transcriptId !== unit.transcriptId ||
    segment.revision !== unit.revision ||
    segment.audioRange.startMs !== unit.audioRange.startMs ||
    segment.audioRange.endMs !== unit.audioRange.endMs ||
    unit.startOffset < 0 ||
    unit.endOffset > segment.text.length ||
    unit.endOffset <= unit.startOffset ||
    segment.text.slice(unit.startOffset, unit.endOffset) !== unit.text
  ) {
    throw new Error('Recap unit does not match current source.');
  }
  return {
    segmentId: unit.segmentId,
    transcriptId: unit.transcriptId,
    revision: unit.revision,
    startOffset: unit.startOffset,
    endOffset: unit.endOffset,
    quote: unit.text,
    audioRange: unit.audioRange,
  };
}
