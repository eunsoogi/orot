jest.mock('../src/storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));
jest.mock('../src/recording/nativeRecordingBridge', () => ({
  installSyntheticTranscriptionRecording: jest.fn(),
  removeSyntheticTranscriptionRecording: jest.fn(),
}));
jest.mock('../src/transcription', () => ({
  appleOnDeviceSpeechTranscriptionProvider: {},
}));

import { openEncryptedStorage } from '@orot/storage';
import {
  audioSourceRecord,
  createDatabase,
  options,
} from '../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import {
  cleanupAutomaticProbeSource,
  syntheticTitle,
} from '../e2e/automaticTranscriptionProbeSupport';
import { removeSyntheticTranscriptionRecording } from '../src/recording/nativeRecordingBridge';
import { openLocalStorage } from '../src/storage/secureDatabase';

/** Real SQLite verifies row ownership and deletion; the mocked file bridge is not native file-protection proof. */
test('cleanup deletes only its synthetic audio source and preserves a foreign source', async () => {
  const database = createDatabase();
  try {
    const repository = await openEncryptedStorage(options(database));
    (openLocalStorage as jest.Mock).mockResolvedValue(repository);
    const id = 'd9939659-a05f-4d23-9e0f-e9e6cf1b3f17';
    const foreign = {
      ...audioSourceRecord('foreign-source'),
      title: 'Foreign fixture',
      contentHash: 'sha256:' + 'b'.repeat(64),
    };
    await repository.put('source_record', {
      ...audioSourceRecord(id),
      title: syntheticTitle,
    });
    await repository.put('source_record', foreign);
    await cleanupAutomaticProbeSource(id);
    expect(await repository.get('source_record', id)).toBeNull();
    expect(await repository.get('source_record', foreign.id)).toMatchObject(
      foreign,
    );
    expect(removeSyntheticTranscriptionRecording).toHaveBeenCalledWith(id);
    (removeSyntheticTranscriptionRecording as jest.Mock).mockClear();
    await expect(cleanupAutomaticProbeSource(foreign.id)).rejects.toThrow(
      'PROBE_SOURCE_MISSING',
    );
    expect(removeSyntheticTranscriptionRecording).not.toHaveBeenCalled();
    expect(await repository.get('source_record', foreign.id)).toMatchObject(
      foreign,
    );
  } finally {
    await database.closeAsync?.();
  }
});
