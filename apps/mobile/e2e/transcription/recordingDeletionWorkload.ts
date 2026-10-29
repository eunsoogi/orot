import { prepareSyntheticTranscriptRecording } from './transcriptEvidenceProbeSupport';
import type { TranscriptEvidenceService } from '../../src/transcription/transcriptEvidenceService';

/** Exercises the real transcript/memory/question cascade without artificial waits or scaled filler. */
export async function prepareRecordingDeletionWorkload(
  workload: unknown,
  service: Pick<TranscriptEvidenceService, 'transcribe'>,
) {
  if (
    workload !== undefined &&
    workload !== 'audio-only' &&
    workload !== 'transcribed-evidence'
  ) {
    throw new Error('Unsupported synthetic recording deletion workload.');
  }
  const recording = await prepareSyntheticTranscriptRecording();
  if (workload === 'transcribed-evidence') {
    // The existing fixture service persists one transcript, one confirmed memory and one derived question.
    // Its recall check verifies the memory exists before the production library becomes ready.
    const segments = await service.transcribe(recording.id);
    if (segments.length !== 1)
      throw new Error('Expected one synthetic transcript evidence segment.');
  }
  return recording;
}
