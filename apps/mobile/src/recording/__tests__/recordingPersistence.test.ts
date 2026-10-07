import type { RecordRepository } from '@orot/storage';
import { saveRecordingSource } from '../recordingPersistence';
import type { CompletedRecording } from '../recordingTypes';

const recording: CompletedRecording = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  durationMs: 12_500,
  startedAt: '2026-10-04T01:00:00.000Z',
  completedAt: '2026-10-04T01:00:12.500Z',
  fileProtection: 'complete',
  excludedFromBackup: false,
};

function repository(existing?: unknown) {
  const value = {
    get: jest.fn(async () => existing),
    put: jest.fn(async () => undefined),
  } as unknown as RecordRepository;
  return value;
}

test('persists one unreviewed audio source with the native recording identity and times', async () => {
  const store = repository();
  const now = () => new Date('2026-10-04T02:00:00.000Z');

  const source = await saveRecordingSource(recording, async () => store, now);

  expect(source).toMatchObject({
    id: recording.id,
    sourceKind: 'audio_recording',
    effectiveAt: recording.startedAt,
    recordedAt: recording.completedAt,
    ingestedAt: '2026-10-04T02:00:00.000Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    title: '상담 녹음',
  });
  expect(store.get).toHaveBeenCalledWith('source_record', recording.id);
  expect(store.put).toHaveBeenCalledWith('source_record', source);
});

test.each(['unknown', 'unverified'] as const)(
  'does not link audio when native file protection is %s',
  async fileProtection => {
    const loadRepository = jest.fn(async () => repository());

    await expect(
      saveRecordingSource({ ...recording, fileProtection }, loadRepository),
    ).rejects.toMatchObject({ code: 'RECORDING_FILE_PROTECTION_FAILED' });
    expect(loadRepository).not.toHaveBeenCalled();
  },
);

test('does not link a recording that remains excluded from device backup', async () => {
  const loadRepository = jest.fn(async () => repository());

  await expect(
    saveRecordingSource(
      { ...recording, excludedFromBackup: true },
      loadRepository,
    ),
  ).rejects.toMatchObject({ code: 'RECORDING_FILE_PROTECTION_FAILED' });
  expect(loadRepository).not.toHaveBeenCalled();
});

test('does not link a recording when native backup eligibility is unknown', async () => {
  const loadRepository = jest.fn(async () => repository());
  // The native bridge must explicitly confirm inclusion; a missing value is not proof.
  const unknownBackupStatus = {
    ...recording,
    excludedFromBackup: undefined,
  } as unknown as CompletedRecording;

  await expect(
    saveRecordingSource(unknownBackupStatus, loadRepository),
  ).rejects.toMatchObject({ code: 'RECORDING_FILE_PROTECTION_FAILED' });
  expect(loadRepository).not.toHaveBeenCalled();
});

test('allows an exact metadata retry and rejects an identity collision', async () => {
  const existing = {
    id: recording.id,
    sourceKind: 'audio_recording',
    effectiveAt: recording.startedAt,
    recordedAt: recording.completedAt,
  };
  const retryStore = repository(existing);
  await expect(
    saveRecordingSource(recording, async () => retryStore),
  ).resolves.toBe(existing);
  expect(retryStore.put).not.toHaveBeenCalled();

  const collisionStore = repository({ ...existing, sourceKind: 'document' });
  await expect(
    saveRecordingSource(recording, async () => collisionStore),
  ).rejects.toThrow('recording source identifier is already in use');
});

test('propagates repository failures so the screen can retry metadata linking', async () => {
  const store = repository();
  store.put = jest
    .fn()
    .mockRejectedValue(new Error('local database unavailable'));

  await expect(
    saveRecordingSource(recording, async () => store),
  ).rejects.toThrow('local database unavailable');
});
