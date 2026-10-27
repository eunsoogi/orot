import { createHealthReviewRequests } from './requests';

/** Native resources load only when the user opens this feature. No list operation runs the graph. */
export async function openHealthReviewResources() {
  const [{ openLocalStorage }, { openLocalWorkflowCheckpointSaver }] =
    await Promise.all([
      import('../storage/secureDatabase'),
      import('../agent/localCheckpointSaver'),
    ]);
  const repository = await openLocalStorage();
  const saver = await openLocalWorkflowCheckpointSaver();
  return {
    repository,
    requests: createHealthReviewRequests(repository, saver),
  };
}

/** Use the actual shared memory engine so removal retains source tombstones and late-write fences. */
export async function deleteHealthReviewSource(sourceId: string) {
  const [databaseModule, ragModule, memoryModule, deletionModule] =
    await Promise.all([
      import('../storage/secureDatabase'),
      import('../rag/localE5RagService'),
      import('../memory/localAgentMemory'),
      import('../memory/removeSourceWithMemory'),
    ]);
  const rag = ragModule.createLocalE5RagService(
    await databaseModule.openLocalAgentMemoryDatabase(),
  );
  const memory = await memoryModule.openOrReuseLocalAgentMemory(rag.provider);
  return deletionModule.removeLocalSourceWithMemory(sourceId, memory);
}
