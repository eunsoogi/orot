import {
  createLangGraphCheckpointStorage,
  requireLiveCheckpointSource,
  type RecordRepository,
} from '@orot/storage';
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

/** Restoration may inspect checkpoints only for a still-current recording. */
export async function requireCurrentEncounterRecording(
  repository: RecordRepository,
  sourceId: string,
) {
  await repository.transaction(async (writer, sql) => {
    if (!sql) throw new Error('Canonical storage required.');
    await requireLiveCheckpointSource(sql, sourceId);
    if (
      (await writer.get('source_record', sourceId))?.sourceKind !==
      'audio_recording'
    )
      throw new Error('Recording source unavailable.');
  });
}
