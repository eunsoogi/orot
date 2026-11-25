import { createLangGraphCheckpointStorage } from '@orot/storage';
import { createEncounterReviewSessions } from '../agent/encounter/reviewSession';
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';

/** Register the existing recording-deletion marker owner before accessing
 * source-linked workflow checkpoints. */
export async function openEncounterReviewSessions(sourceId: string) {
  const database = await openLocalAgentMemoryDatabase();
  await new SqlCipherAgentMemoryStorage(database).listRemovedSourceIds();
  const storage = createLangGraphCheckpointStorage(database, {
    sourceRecordId: sourceId,
  });
  return {
    storage,
    discovery: createEncounterReviewSessions(storage, sourceId),
  };
}
