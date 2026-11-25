import type { AgentMemoryStorageAdapter } from './types';
import { provenanceFrom } from './validation';

type Stage = 'queue' | 'provenance';
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
