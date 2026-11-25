import type {
  AgentMemorySourceCascade,
  PersistedMemoryRecord,
} from '@orot/agent-memory';
import type { SqlDatabase } from '@orot/storage';
import type { SqlCipherAgentMemoryStorage } from './agentMemoryStorage';
import { commitAgentMemoryWrites } from './agentMemoryStorageWrites';
import { notifyCommittedAgentMemoryVisibility } from './agentMemoryVisibilityEvents';

/** Source ownership comes from the admitted removal; the namespace comes from the app wrapper. */
export function createScopedAgentMemoryCascade(
  storage: Pick<SqlCipherAgentMemoryStorage, 'beginBatch' | 'rollbackBatch'>,
  database: SqlDatabase,
  prepare: () => Promise<void>,
) {
  return async (
    intent: AgentMemorySourceCascade,
    namespaceIdentity?: string,
  ): Promise<readonly string[]> => {
    if (!validNamespaceIdentity(namespaceIdentity) || !intent.references.size)
      throw new Error(
        'A scoped source-removal owner and references are required.',
      );
    // Do not read the caller's mutable collections across the admission await.
    const sources = new Set(intent.references);
    const candidates = new Set(intent.candidateIds);
    const kinds = new Map<string, string[] | undefined>();
    for (const reference of intent.typedReferences ?? []) {
      if (!sources.has(reference.id)) continue;
      const aliases = kinds.get(reference.id);
      if (aliases) aliases.push(reference.kind);
      else kinds.set(reference.id, [reference.kind]);
    }
    storage.beginBatch();
    try {
      await prepare();
      const { changed, committedMemoryIds } = await commitAgentMemoryWrites(
        database,
        new Map(),
        sources,
        kinds,
        undefined,
        { namespaceIdentity, candidates },
        intent.observe,
      );
      if (changed) notifyCommittedAgentMemoryVisibility(database);
      return committedMemoryIds;
    } finally {
      storage.rollbackBatch();
    }
  };
}
function validNamespaceIdentity(value: string | undefined): value is string {
  if (typeof value !== 'string') return false;
  try {
    const scope: unknown = JSON.parse(value);
    return (
      Array.isArray(scope) &&
      scope.every(
        part =>
          typeof part === 'string' && part.length > 0 && part.trim() === part,
      ) &&
      JSON.stringify(scope) === value
    );
  } catch {
    return false;
  }
}

export interface PendingBatch {
  readonly writes: Map<string, PersistedMemoryRecord | null>;
  readonly removedSourceIds: Set<string>;
  readonly removedKinds: Map<string, readonly string[] | undefined>;
}
