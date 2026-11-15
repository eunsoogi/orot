/** Browse protected storage only on demand, without preparing a model or provider. */
export async function loadSavedLocalMemories() {
  const [
    { listSavedMemories },
    { SqlCipherAgentMemoryStorage },
    { openLocalAgentMemoryDatabase },
  ] = await Promise.all([
    import('@orot/agent-memory'),
    import('../storage/agentMemoryStorage'),
    import('../storage/secureDatabase'),
  ]);
  const database = await openLocalAgentMemoryDatabase();
  return listSavedMemories(new SqlCipherAgentMemoryStorage(database));
}
