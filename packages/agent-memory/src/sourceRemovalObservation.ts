import type { AgentMemoryStorageAdapter } from './types';
import { provenanceFrom } from './validation';

type Stage = 'queue' | 'provenance' | 'engine' | 'forget' | 'fences' | 'commit';
type Event = 'begin' | 'success' | 'failure';

/** Optional observation emits stage and outcome only, never source or Memory data. */
export type RemovalObserver = (stage: Stage, event: Event) => void;

export function observeRemoval(
  observer: RemovalObserver | undefined,
  stage: Stage,
  event: Event,
): void {
  try {
    observer?.(stage, event);
  } catch {
    // Observation cannot interfere with a privacy-sensitive deletion.
  }
}

/** Measure a fixed, whole phase without forwarding inputs, counts, or errors. */
export function timeRemoval<T>(
  observer: RemovalObserver | undefined,
  stage: Stage,
  operation: () => Promise<T>,
): Promise<T> {
  if (!observer) return operation();
  observeRemoval(observer, stage, 'begin');
  const reject = (error: unknown): never => {
    observeRemoval(observer, stage, 'failure');
    throw error;
  };
  try {
    return operation().then((value) => {
      observeRemoval(observer, stage, 'success');
      return value;
    }, reject);
  } catch (error) {
    observeRemoval(observer, stage, 'failure');
    return Promise.reject(error);
  }
}

/** Preserve the existing provenance scan inside the admitted Memory queue. */
export async function scanRemoval(
  storage: AgentMemoryStorageAdapter,
  references: ReadonlySet<string>,
  observe?: RemovalObserver,
): Promise<string[]> {
  observeRemoval(observe, 'provenance', 'begin');
  try {
    const records = await storage.listRecords();
    const ids = records
      .filter((record) =>
        provenanceFrom(record.meta)?.sourceIds.some((referenceId) => references.has(referenceId)),
      )
      .map((record) => record.id);
    observeRemoval(observe, 'provenance', 'success');
    return ids;
  } catch (error) {
    observeRemoval(observe, 'provenance', 'failure');
    throw error;
  }
}
