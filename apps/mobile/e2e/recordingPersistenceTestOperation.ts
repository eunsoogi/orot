import { recordingLibraryService } from '../src/recording/recordingLibraryService';
import { createTranscriptEvidenceService } from '../src/transcription/transcriptEvidenceService';
import {
  cleanupSyntheticTranscriptRecording,
  createTranscriptEvidenceProbeService,
  prepareSyntheticTranscriptRecording,
} from './transcription/transcriptEvidenceProbeSupport';
import {
  seedTranscriptDeletionEvidence,
  verifyTranscriptDeletionAfterRelaunch,
} from './transcription/transcriptDeletionProbeSupport';

const correction = '사용자가 확인한 전사 수정';

/** Synthetic recognition is explicit; correction, SQLCipher, memory invalidation and native file deletion are real. */
async function correctedRecording() {
  const recording = await prepareSyntheticTranscriptRecording();
  const service = createTranscriptEvidenceProbeService(
    () => {},
    () => {},
  );
  const original = (await service.transcribe(recording.id))[0];
  if (!original || original.text !== '합성 전사 원문입니다.')
    throw new Error(
      'Transcript integration did not prepare its original revision',
    );
  const revised = await service.correct(original.id, correction);
  await service.verifyMemoryInvalidation();
  const saved = await service.load(recording.id);
  if (
    !saved ||
    saved.segments.length !== 2 ||
    saved.segments[0]?.text !== original.text ||
    revised.text !== correction ||
    revised.revision !== 2 ||
    revised.reviewState.status !== 'needs_review' ||
    saved.staleArtifacts.length !== 1 ||
    revised.audioRange.startMs !== 250 ||
    revised.audioRange.endMs !== 1801
  )
    throw new Error(
      'Correction lost revision history, review state, source range or stale evidence',
    );
  return { sourceId: recording.id, saved };
}

/** Keep one corrected source and delete another, so the next real process proves both presence and absence. */
export async function seedRecordingPersistence() {
  const retained = await correctedRecording();
  const deleted = await correctedRecording();
  await seedTranscriptDeletionEvidence(deleted.sourceId);
  const result = await recordingLibraryService.deleteRecording(
    deleted.sourceId,
  );
  if (result.audioCleanupPending)
    throw new Error('Transcript integration left staged audio pending');
  return {
    retainedSourceId: retained.sourceId,
    retained: retained.saved,
    deletedSourceId: deleted.sourceId,
    memoryInvalidation: 'passed',
    deletionCommitted: true,
    syntheticRecognition: true,
  };
}

/** This operation is called only from the host's second XCTest process; native and host receipts enforce that boundary. */
export async function readRecordingPersistence(
  parameters: Record<string, unknown>,
) {
  const { retainedSourceId, deletedSourceId } = parameters;
  for (const id of [retainedSourceId, deletedSourceId]) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))
      throw new Error(
        'Recording persistence requires both exact fixture identifiers',
      );
  }
  await verifyTranscriptDeletionAfterRelaunch(deletedSourceId as string);
  const retained = await createTranscriptEvidenceService().load(
    retainedSourceId as string,
  );
  if (!retained) throw new Error('The retained corrected recording was lost');
  await cleanupSyntheticTranscriptRecording(retainedSourceId as string);
  return {
    retained,
    deletedSourceId,
    deletionAbsent: true,
    retainedCleaned: true,
  };
}
