import type { RecapResult, TranscriptEvidenceSegment } from '@orot/domain';
import type { RecapCompletionOutcome } from './recapCompletion';

export interface AutomaticRecapPorts {
  bindingKey?(sourceId: string): Promise<string>;
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
  return async function run(
    sourceId: string,
    segments: readonly TranscriptEvidenceSegment[],
    signal: AbortSignal,
  ) {
    const binding = (await ports.bindingKey?.(sourceId)) ?? '';
    const key = JSON.stringify([sourceId, binding]);
    const existing = active.get(key);
    if (existing) return existing;
    const work = (async (): Promise<
      RecapCompletionOutcome | { status: 'saved' | 'save_failed' }
    > => {
      if (signal.aborted) return { status: 'cancelled' };
      const recordStatus = await ports.beginStatus?.(sourceId);
      const cancelled = async () => {
        await recordStatus?.('cancelled');
        return { status: 'cancelled' as const };
      };
      await recordStatus?.('analyzing');
      let result: RecapResult | null;
      try {
        result = await ports.readCurrent(sourceId);
      } catch {
        await recordStatus?.('save_failed');
        return { status: 'save_failed' };
      }
      if (!result) {
        let extracted: RecapCompletionOutcome;
        try {
          extracted = await ports.extract(sourceId, segments, signal);
        } catch {
          await recordStatus?.('save_failed');
          return { status: 'save_failed' };
        }
        if (extracted.status !== 'result') {
          await recordStatus?.(extracted.status);
          return extracted;
        }
        if (signal.aborted) return cancelled();
        result = extracted.value;
        try {
          await ports.cache(result);
        } catch {
          await recordStatus?.('save_failed');
          return { status: 'save_failed' };
        }
      }
      if (signal.aborted) return cancelled();
      try {
        await recordStatus?.('saving');
        // Once the official transaction starts it may commit; check immediately before it.
        if (signal.aborted) return cancelled();
        await ports.saveOfficial(result);
        return { status: 'saved' };
      } catch {
        await recordStatus?.('save_failed');
        return { status: 'save_failed' };
      }
    })();
    active.set(key, work);
    work.then(
      () => active.delete(key),
      () => active.delete(key),
    );
    return work;
  };
}
