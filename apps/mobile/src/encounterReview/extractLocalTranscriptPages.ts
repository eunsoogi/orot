import {
  encounterCanonical,
  encounterReferences,
  validateEncounterCandidates,
} from '@orot/agent-runtime';
import type {
  EncounterCandidate,
  EncounterTranscript,
} from '@orot/agent-runtime';
import type { openLocalTranscriptPages } from './localTranscriptPages';

type Pages = Awaited<ReturnType<typeof openLocalTranscriptPages>>;
type Options = {
  readonly sourceId: string;
  readonly signal: AbortSignal;
  readonly selectionCurrent: () => boolean;
  readonly pages: Pages;
  readonly extract: (
    batch: EncounterTranscript,
    index: number,
    current: () => Promise<boolean>,
    signal: AbortSignal,
  ) => Promise<EncounterCandidate[]>;
};

type Result =
  | {
      readonly status: 'complete';
      readonly segments: ReturnType<typeof encounterReferences>;
      readonly candidates: EncounterCandidate[];
    }
  | { readonly status: 'empty' | 'unavailable' | 'cancelled' };

// This is a per-invocation width, not a limit on the recording.
const batchSize = 8;

/** Ephemeral only. No partial candidates, transcript text or checkpoint leave
 * this operation. The caller must still reprove the returned revision sequence
 * before putting the result into review or committing approved records. */
export async function extractLocalTranscriptPages(
  input: Options,
): Promise<Result> {
  const { pages, sourceId, signal } = input;
  let retired = false;
  const valid = () =>
    !signal.aborted && !pages.signal.aborted && input.selectionCurrent();
  const current = async () => {
    if (retired) return false;
    if (valid() && (await pages.confirm()) && !retired && valid()) return true;
    retired = true;
    return false;
  };
  const interrupted = (): Result => ({
    status: signal.aborted ? 'cancelled' : 'unavailable',
  });
  try {
    const segments: ReturnType<typeof encounterReferences> = [];
    const candidates = new Map<string, EncounterCandidate>();
    const seen = new Set<string>();
    let batchIndex = 0;
    let ordinal = -1;
    let ordinalId = '';
    while (await current()) {
      const page = await pages.next();
      if (!(await current())) return interrupted();
      if (!page) return segments.length ? interrupted() : { status: 'empty' };
      if (!page.segments.length) return interrupted();
      for (let i = 0; i < page.segments.length; i += batchSize) {
        const batch: EncounterTranscript = { sourceId, segments: [] };
        for (const row of page.segments.slice(i, i + batchSize)) {
          if (
            row.recordingSourceId !== sourceId ||
            seen.has(row.transcriptId) ||
            row.segmentOrdinal < ordinal ||
            (row.segmentOrdinal === ordinal && row.id <= ordinalId)
          )
            return interrupted();
          seen.add(row.transcriptId);
          ordinal = row.segmentOrdinal;
          ordinalId = row.id;
          const { id, transcriptId, revision, text, effectiveAt, audioRange } =
            row;
          batch.segments.push({
            id,
            transcriptId,
            revision,
            text,
            effectiveAt,
            audioRange,
          });
        }
        if (!(await current())) return interrupted();
        const extracted = await input.extract(
          batch,
          batchIndex++,
          current,
          pages.signal,
        );
        if (!(await current())) return interrupted();
        validateEncounterCandidates(extracted, batch);
        segments.push(...encounterReferences(batch));
        for (const { id: _id, ...candidate } of extracted) {
          const key = encounterCanonical(candidate);
          if (!candidates.has(key))
            candidates.set(key, {
              ...candidate,
              id: 'candidate-' + candidates.size,
            });
        }
      }
      if (page.done && (await current()))
        return {
          status: 'complete',
          segments,
          candidates: [...candidates.values()],
        };
      if (page.done) return interrupted();
    }
    return interrupted();
  } catch {
    return interrupted();
  } finally {
    pages.dispose();
  }
}
