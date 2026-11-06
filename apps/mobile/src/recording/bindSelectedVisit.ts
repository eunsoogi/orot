import { bindRecordingToVisit } from '@orot/storage';

/** Bind only the user's selected visit after the protected recording source exists. */
export async function bindSelectedVisit(
  recordingId: string,
  appointmentId: string,
) {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  await bindRecordingToVisit(
    await openLocalAgentMemoryDatabase(),
    recordingId,
    appointmentId,
  );
}
