import { bindRecordingToUnchangedVisit, type SqlDatabase } from '@orot/storage';
import {
  selectAutomaticRecordingVisit,
  type AutomaticRecordingVisit,
} from './automaticRecordingVisit';

async function openDatabase() {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  return openLocalAgentMemoryDatabase();
}

/** Association is optional; a stale/deleted visit or locked database must not turn saved audio into a failed save. */
export async function bindAutomaticRecordingVisit(
  recordingId: string,
  visit: AutomaticRecordingVisit | null,
  open: () => Promise<SqlDatabase> = openDatabase,
) {
  if (!visit) return;
  let current = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = async () => {
    try {
      const database = await open();
      if (current)
        await bindRecordingToUnchangedVisit(
          database,
          recordingId,
          visit,
          () => current,
        );
    } catch {
      // Optional association errors never turn protected audio into a failed recording save.
    }
  };
  try {
    await Promise.race([
      write(),
      new Promise<void>(resolve => {
        timer = setTimeout(() => {
          current = false;
          resolve();
        }, 1500);
      }),
    ]);
  } finally {
    // The transaction checks this lease before insertion and before commit; late work rolls back.
    current = false;
    if (timer) clearTimeout(timer);
  }
}

/** Calendar lookup is optional: a locked database cannot indefinitely delay the microphone action. */
export async function selectRecordingVisitWithinDeadline(
  now: string,
): Promise<AutomaticRecordingVisit | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      selectAutomaticRecordingVisit(now),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), 1500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
