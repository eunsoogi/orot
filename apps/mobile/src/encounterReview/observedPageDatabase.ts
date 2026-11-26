import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';
import { subscribeTranscriptCorrection } from '../storage/transcriptCorrectionVisibility';

/** Bind passive correction retirement to the exact database already used for
 * pages. No re-read, polling or new access permission follows a notification. */
export async function openObservedEncounterPageDatabase(
  sourceId: string,
  lease: { signal: AbortSignal; dispose: () => void },
) {
  const database = await openLocalAgentMemoryDatabase();
  if (!lease.signal.aborted) {
    const stop = subscribeTranscriptCorrection(
      database,
      sourceId,
      lease.dispose,
    );
    lease.signal.addEventListener('abort', stop, { once: true });
  }
  return database;
}
