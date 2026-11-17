import { t } from '../i18n';
import type { AgentSavedMemory } from './unifiedSavedMemories';
import { observeSavedMemoryRead } from './savedMemoryReadDiagnostics';

/** Browse protected storage only on demand, without preparing a model or provider. */
export async function loadSavedLocalMemories() {
  const [
    { listSavedMemories },
    { SqlCipherAgentMemoryStorage },
    { openLocalAgentMemoryDatabase },
  ] = await observeSavedMemoryRead('saved_memory_modules', () =>
    Promise.all([
      import('@orot/agent-memory'),
      import('../storage/agentMemoryStorage'),
      import('../storage/secureDatabase'),
    ]),
  );
  const database = await observeSavedMemoryRead(
    'saved_memory_open',
    openLocalAgentMemoryDatabase,
  );
  return observeSavedMemoryRead(
    'saved_memory_read',
    async (): Promise<AgentSavedMemory[]> => {
      const storage = new SqlCipherAgentMemoryStorage(database);
      const memories = await listSavedMemories(storage);
      const hidden = await storage.listUnavailableMetadata();
      const hiddenIds = new Set(hidden.map(row => row.id));
      return [
        ...memories.filter(row => !hiddenIds.has(row.id)),
        ...hidden.map(row => ({
          id: row.id,
          memoryKey: row.id,
          createdAt: row.createdAt,
          text: t('savedMemory.quarantinedParent'),
          kind: 'reviewed_interaction' as const,
          provenance: {
            sourceIds: [],
            sourceDates: [],
            reviewState: 'human_reviewed' as const,
          },
          unavailableReason: row.reason,
        })),
      ];
    },
  );
}
