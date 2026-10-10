import type { RecordRepository } from '@orot/storage';
import type { RecordingSourceRecord } from './recordingTypes';

/** Home only reads saved metadata. Audio recovery and playback remain owned by the recording library. */
export async function loadRecordingSummaries(
  loadRepository: () => Promise<RecordRepository> = async () => {
    const { openLocalStorage } = await import('../storage/secureDatabase');
    return openLocalStorage();
  },
): Promise<readonly RecordingSourceRecord[]> {
  const repository = await loadRepository();
  const sources = await repository.list('source_record');
  return sources
    .filter(source => source.sourceKind === 'audio_recording')
    .sort(
      (left, right) =>
        Date.parse(right.recordedAt) - Date.parse(left.recordedAt),
    );
}
