import {
  AppleOnDeviceSpeechProvider,
  appleSpeechTranscriptionNativeBridge,
} from '../src/transcription';
import { createTranscriptEvidenceService } from '../src/transcription/transcriptEvidenceService';
import { openLocalStorage } from '../src/storage/secureDatabase';
import { prepareSyntheticTranscriptRecording } from './transcription/transcriptEvidenceProbeSupport';
import { removeSyntheticTranscriptionRecording } from '../src/recording/nativeRecordingBridge';

// Mark only bundled synthetic recordings for the existing Simulator protection exception.
// The Apple bridge still performs recognition; no transcript or availability is substituted.
const provider = new AppleOnDeviceSpeechProvider({
  ...appleSpeechTranscriptionNativeBridge,
  async transcribeRecording(request) {
    const operation = appleSpeechTranscriptionNativeBridge.transcribeRecording;
    if (!operation)
      throw new Error('Native recording transcription is unavailable');
    return operation({ ...request, syntheticFixture: true });
  },
});

export const journeyTranscriptService = createTranscriptEvidenceService({
  provider,
});

export interface SpeechJourneyResult {
  sourceId: string;
  text: string;
  firstSegmentText: string;
  segmentCount: number;
  engine: string;
}

export async function createSpeechJourney(): Promise<SpeechJourneyResult> {
  const recording = await prepareSyntheticTranscriptRecording();
  try {
    await journeyTranscriptService.transcribe(recording.id);
    return await readSpeechJourney(recording.id);
  } catch (failure) {
    try {
      await deleteSpeechJourney(recording.id);
    } catch (cleanupFailure) {
      throw new Error(
        `Native recognition failed: ${String(failure)}; cleanup failed: ${String(cleanupFailure)}`,
      );
    }
    throw failure;
  }
}

export async function readSpeechJourney(
  sourceId: string,
): Promise<SpeechJourneyResult> {
  const repository = await openLocalStorage();
  const source = await repository.get('source_record', sourceId);
  if (
    source?.sourceKind !== 'audio_recording' ||
    source.title !== 'Synthetic transcription test recording'
  ) {
    throw new Error('The owned synthetic recording was not restored');
  }
  const segments = await repository.transcripts.listForRecording(sourceId);
  if (segments.length === 0)
    throw new Error('No native transcript was persisted');
  for (const segment of segments) {
    if (
      !segment.text.trim() ||
      segment.provenance.source?.system !== 'Apple Speech' ||
      segment.recordingSourceId !== sourceId
    ) {
      throw new Error(
        'Saved transcript does not contain the real Apple result',
      );
    }
  }
  return {
    sourceId,
    text: segments.map(segment => segment.text).join(' '),
    firstSegmentText: segments[0].text,
    segmentCount: segments.length,
    engine: segments[0].provenance.source?.sourceIdentifier ?? '',
  };
}

export async function deleteSpeechJourney(sourceId: string): Promise<void> {
  const repository = await openLocalStorage();
  const source = await repository.get('source_record', sourceId);
  if (
    source?.sourceKind !== 'audio_recording' ||
    source.title !== 'Synthetic transcription test recording'
  ) {
    throw new Error(
      'Refusing to delete a recording outside this synthetic journey',
    );
  }
  // Delete only the ID produced by this journey; real app records and other fixtures are untouched.
  await repository.sourceRecords.delete(sourceId);
  await removeSyntheticTranscriptionRecording(sourceId);
  if (
    (await repository.get('source_record', sourceId)) ||
    (await repository.transcripts.listForRecording(sourceId)).length !== 0
  ) {
    throw new Error('Native journey records remained after cleanup');
  }
}
