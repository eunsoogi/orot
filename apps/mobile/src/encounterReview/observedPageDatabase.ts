import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';
import { subscribeTranscriptCorrection } from '../storage/transcriptCorrectionVisibility';

/** Keep the same review lease subscribed from page read through presentation.
 * Committed invalidations retire it without reading protected data again. */
export async function openObservedEncounterPageDatabase(
  sourceId: string,
  lease: { signal: AbortSignal; dispose: () => void },
) {
  const database = await openLocalAgentMemoryDatabase();
  if (!lease.signal.aborted) {
    const stopCorrection = subscribeTranscriptCorrection(
      database,
      sourceId,
      lease.dispose,
    );
    const stopClear = subscribeLocalDataClear(lease.dispose);
    const stopDelete = subscribeLocalSourceDeletion((_origin, ids) => {
      if (!ids || ids.has(sourceId)) lease.dispose();
    }, 'local');
    lease.signal.addEventListener(
      'abort',
      () => {
        stopCorrection();
        stopClear();
        stopDelete();
      },
      { once: true },
    );
  }
  return database;
}
