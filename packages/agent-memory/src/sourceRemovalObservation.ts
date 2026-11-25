import type { Memory } from 'rememori';
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
async function scanRemoval(
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

async function selectSourceRemoval(
  storage: AgentMemoryStorageAdapter,
  sourceId: string,
  dependentReferenceIds: readonly string[],
  observe?: RemovalObserver,
) {
  const normalizedId = sourceId.trim();
  if (!normalizedId) throw new Error('A source identifier is required.');
  const references = new Set([
    normalizedId,
    ...dependentReferenceIds.map((referenceId) => referenceId.trim()).filter(Boolean),
  ]);
  const ids = await scanRemoval(storage, references, observe);
  return { ids, deletionFences: new Set([...references, ...ids]) };
}

type SourceRemovalSelection = Awaited<ReturnType<typeof selectSourceRemoval>>;

/** Prepare exact scoped removals inside the existing caller-owned batch. */
async function removeMemoryReferences(
  storage: AgentMemoryStorageAdapter,
  getEngine: () => Promise<Pick<Memory, 'forget'>>,
  { ids, deletionFences }: SourceRemovalSelection,
  typedReferences?: readonly { id: string; kind: string }[],
  observe?: RemovalObserver,
): Promise<number> {
  const engine = await timeRemoval(observe, 'engine', getEngine);
  const forgotten = await timeRemoval(observe, 'forget', async () => {
    let count = 0;
    for (const id of ids) if (await engine.forget(id)) count += 1;
    return count;
  });
  await timeRemoval(observe, 'fences', async () => {
    // Checkpoints may cite the Memory row itself, its source, or a cascaded transcript identity.
    for (const referenceId of deletionFences) {
      const kinds = typedReferences
        ?.filter((reference) => reference.id === referenceId)
        .map((reference) => reference.kind);
      await storage.markSourceRemoved(
        referenceId,
        kinds?.length && !ids.includes(referenceId) ? kinds : undefined,
      );
    }
  });
  return forgotten;
}

interface SourceRemovalWork {
  readonly sourceId: string;
  readonly dependentReferenceIds: readonly string[];
  readonly typedReferences: readonly { id: string; kind: string }[] | undefined;
  readonly storage: AgentMemoryStorageAdapter;
  readonly getEngine: () => Promise<Pick<Memory, 'forget'>>;
  readonly observe: RemovalObserver | undefined;
  readonly runBatch: (operation: () => Promise<number>) => Promise<number>;
}

/** The caller still owns Memory queue admission, transaction, and source commit. */
export async function runSourceRemovalBatch({
  sourceId,
  dependentReferenceIds,
  typedReferences,
  storage,
  getEngine,
  observe,
  runBatch,
}: SourceRemovalWork) {
  const selection = await selectSourceRemoval(storage, sourceId, dependentReferenceIds, observe);
  const memoriesDeleted = await runBatch(() =>
    removeMemoryReferences(storage, getEngine, selection, typedReferences, observe),
  );
  return { deletionFences: selection.deletionFences, memoriesDeleted };
}
