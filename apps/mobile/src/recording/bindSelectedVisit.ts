import { bindRecordingToVisit, unbindRecordingFromVisit } from '@orot/storage';

/** Bind only the user's selected visit after the protected recording source exists. */
export async function bindSelectedVisit(
  recordingId: string,
  appointmentId: string | null,
) {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  const database = await openLocalAgentMemoryDatabase();
  if (appointmentId)
    await bindRecordingToVisit(database, recordingId, appointmentId);
  else await unbindRecordingFromVisit(database, recordingId);
}
