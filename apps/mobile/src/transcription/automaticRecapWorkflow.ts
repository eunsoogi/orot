import type { RecapResult, TranscriptEvidenceSegment } from '@orot/domain';
import type { RecapCompletionOutcome } from './recapCompletion';

export interface AutomaticRecapPorts {
  readCurrent(sourceId: string): Promise<RecapResult | null>;
  extract(
    sourceId: string,
    segments: readonly TranscriptEvidenceSegment[],
    signal: AbortSignal,
  ): Promise<RecapCompletionOutcome>;
  cache(result: RecapResult): Promise<void>;
  /** Must revalidate and commit even when no question has evidence. */
  saveOfficial(result: RecapResult): Promise<unknown>;
  beginStatus?(sourceId: string): Promise<(status: string) => Promise<void>>;
}

const active = new Map<
  string,
  Promise<RecapCompletionOutcome | { status: 'saved' | 'save_failed' }>
>();

/** Cache survives a failed official write; only a committed official write can yield saved. */
export function createAutomaticRecapWorkflow(ports: AutomaticRecapPorts) {
  return function run(
    sourceId: string,
    segments: readonly TranscriptEvidenceSegment[],
    signal: AbortSignal,
  ) {
    const existing = active.get(sourceId);
    if (existing) return existing;
    const work = (async (): Promise<
      RecapCompletionOutcome | { status: 'saved' | 'save_failed' }
    > => {
      if (signal.aborted) return { status: 'cancelled' };
      const recordStatus = await ports.beginStatus?.(sourceId);
      await recordStatus?.('analyzing');
      let result = await ports.readCurrent(sourceId);
      if (!result) {
        const extracted = await ports.extract(sourceId, segments, signal);
        if (extracted.status !== 'result') {
          await recordStatus?.(extracted.status);
          return extracted;
        }
        if (signal.aborted) return { status: 'cancelled' };
        result = extracted.value;
        try {
          await ports.cache(result);
        } catch {
          await recordStatus?.('save_failed');
          return { status: 'save_failed' };
        }
      }
      if (signal.aborted) return { status: 'cancelled' };
      try {
        await recordStatus?.('saving');
        await ports.saveOfficial(result);
        return { status: 'saved' };
      } catch {
        await recordStatus?.('save_failed');
        return { status: 'save_failed' };
      }
    })();
    active.set(sourceId, work);
    work.then(
      () => active.delete(sourceId),
      () => active.delete(sourceId),
    );
    return work;
  };
}
