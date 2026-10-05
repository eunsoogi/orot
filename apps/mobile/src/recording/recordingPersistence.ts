import type { RecordMap, RecordRepository } from '@orot/storage';
import type { CompletedRecording } from './recordingTypes';

type RecordingRepositoryLoader = () => Promise<RecordRepository>;
type SourceRecord = RecordMap['source_record'];

async function loadLocalRepository(): Promise<RecordRepository> {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  return openLocalStorage();
}

export async function saveRecordingSource(
  recording: CompletedRecording,
  loadRepository: RecordingRepositoryLoader = loadLocalRepository,
  now: () => Date = () => new Date(),
): Promise<SourceRecord> {
  if (
    recording.fileProtection !== 'complete' ||
    !recording.excludedFromBackup
  ) {
    const error = new Error(
      'The recording file protection could not be verified.',
    ) as Error & {
      code?: string;
    };
    error.code = 'RECORDING_FILE_PROTECTION_FAILED';
    throw error;
  }

  const repository = await loadRepository();
  const existing = await repository.get('source_record', recording.id);
  if (existing) {
    if (
      existing.sourceKind === 'audio_recording' &&
      existing.effectiveAt === recording.startedAt &&
      existing.recordedAt === recording.completedAt
    ) {
      return existing;
    }
    throw new Error('The recording source identifier is already in use.');
  }

  const source: SourceRecord = {
    id: recording.id,
    effectiveAt: recording.startedAt,
    recordedAt: recording.completedAt,
    ingestedAt: now().toISOString(),
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    sourceKind: 'audio_recording',
    title: '상담 녹음',
  };
  await repository.put('source_record', source);
  return source;
}
