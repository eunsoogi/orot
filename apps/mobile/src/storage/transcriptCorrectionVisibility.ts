import type { RecordRepository, SqlDatabase } from '@orot/storage';
import { notifyCommittedAgentMemoryVisibility } from './agentMemoryVisibilityEvents';
import { protectedDatabaseOwnerIdentity } from './protectedReadEpoch';

/** Compose only with the stock repository produced from this exact guarded owner. */
export function bindTranscriptCorrectionVisibility(
  records: RecordRepository,
  owner: SqlDatabase,
): RecordRepository {
  if (!protectedDatabaseOwnerIdentity(owner)) return records;
  const transcripts = records.transcripts;
  return {
    ...records,
    transcripts: {
      ...transcripts,
      async correct(segmentId, text, correctedAt) {
        const corrected = await transcripts.correct(
          segmentId,
          text,
          correctedAt,
        );
        const priorId = segmentId.trim();
        if (corrected.id !== priorId && corrected.supersedesId === priorId)
          notifyCommittedAgentMemoryVisibility(owner);
        return corrected;
      },
    },
  };
}
