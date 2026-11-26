import type { RecordRepository, SqlDatabase } from '@orot/storage';
import { notifyCommittedAgentMemoryVisibility } from './agentMemoryVisibilityEvents';
import { protectedDatabaseOwnerIdentity } from './protectedReadEpoch';

type Listener = () => void;
const corrections = new WeakMap<object, Map<string, Set<Listener>>>();

/** Wake only the exact recording's visible review on this guarded writer.
 * Raw/foreign SQLite connections cannot synthesize this local commit event. */
export function subscribeTranscriptCorrection(
  database: SqlDatabase,
  recordingId: string,
  invalidate: Listener,
): () => void {
  const owner = protectedDatabaseOwnerIdentity(database);
  if (!owner) return () => {};
  const byRecording =
    corrections.get(owner) ?? new Map<string, Set<Listener>>();
  corrections.set(owner, byRecording);
  const listeners = byRecording.get(recordingId) ?? new Set<Listener>();
  byRecording.set(recordingId, listeners);
  listeners.add(invalidate);
  return () => {
    listeners.delete(invalidate);
    if (!listeners.size && byRecording.get(recordingId) === listeners)
      byRecording.delete(recordingId);
  };
}

function notifyTranscriptCorrection(
  database: SqlDatabase,
  recordingId: string,
) {
  const owner = protectedDatabaseOwnerIdentity(database);
  const listeners = owner && corrections.get(owner)?.get(recordingId);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    if (!listeners.has(listener)) continue;
    try {
      listener();
    } catch {
      // This is presentation retirement, never part of the durable correction.
    }
  }
}

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
        if (corrected.id !== priorId && corrected.supersedesId === priorId) {
          notifyTranscriptCorrection(owner, corrected.recordingSourceId);
          notifyCommittedAgentMemoryVisibility(owner);
        }
        return corrected;
      },
    },
  };
}
