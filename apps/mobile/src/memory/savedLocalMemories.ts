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
  return observeSavedMemoryRead('saved_memory_read', () =>
    listSavedMemories(new SqlCipherAgentMemoryStorage(database)),
  );
}
