import {
  holdMetadataResult,
  completeSynchronousSqlWork,
} from '../testSupport/recordingSummaryRaceHarness';
import { open } from '@op-engineering/op-sqlite';
import { createAgentMemory } from '@orot/agent-memory';
import { providerSuccess } from '@orot/model-runtime';
import { createDatabase } from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { embedder } from '../../../../../packages/agent-memory/__tests__/testFixtures';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { createTranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import { removeLocalSourceWithMemory } from '../../memory/removeSourceWithMemory';
import { createRecordingLibraryService } from '../recordingLibraryService';
import { saveRecordingSource } from '../recordingPersistence';
import { getAutomaticTranscriptionStore } from '../automaticTranscriptionStore';

// Replace platform I/O only. The secure facade, repository, SQL migrations and deletion cascade stay real.
jest.mock('@op-engineering/op-sqlite', () => ({
  IOS_LIBRARY_PATH: '/synthetic-library',
  isSQLCipher: () => true,
  open: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {
    WHEN_UNLOCKED: 'unlocked',
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  },
  getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
    service.includes('initialization')
      ? { username: 'state', password: 'ready' }
      : { username: 'database', password: 'ab'.repeat(32) },
  ),
  setGenericPassword: jest.fn(async () => true),
}));
jest.mock('../../backup/nativeBackupMigration', () => ({
  migrateDatabaseKeyForBackup: async () => {},
  getDatabaseFileState: async () => 'present',
  isDatabaseKeyBackupEligible: async () => true,
}));
jest.mock('../../rag/localE5NativeBackend', () => ({
  localE5NativeBackend: {},
}));
jest.mock('../../transcription/index', () => ({
  appleOnDeviceSpeechTranscriptionProvider: { transcribeRecording: jest.fn() },
}));

const database = createDatabase();
beforeAll(() => {
  jest
    .mocked(open)
    .mockReturnValue(database as unknown as ReturnType<typeof open>);
});
afterAll(async () => {
  await database.closeAsync?.();
});

test('concurrent production opens reuse one limited facade after the storage singleflight succeeds', async () => {
  const [first, second] = await Promise.all([
    openLocalAgentMemoryDatabase(),
    openLocalAgentMemoryDatabase(),
  ]);
  expect(open).toHaveBeenCalledTimes(1);
  expect(first).toBe(second);
  expect(Object.keys(first).sort()).toEqual(['execute', 'transaction']);
});

async function harness(sourceId: string) {
  const repository = await openLocalStorage();
  // This unit begins at the native stop result; it does not simulate microphone capture.
  await saveRecordingSource(
    {
      id: sourceId,
      durationMs: 2000,
      startedAt: '2026-10-29T00:00:00.000Z',
      completedAt: '2026-10-29T00:00:02.000Z',
      fileProtection: 'complete',
      excludedFromBackup: false,
    },
    openLocalStorage,
  );
  const memory = await createAgentMemory({
    embedder,
    storage: new SqlCipherAgentMemoryStorage(
      await openLocalAgentMemoryDatabase(),
    ),
  });
  const audioOrder: string[] = [];
  const library = createRecordingLibraryService({
    loadRepository: openLocalStorage,
    openMemory: async () => memory,
    removeSource: removeLocalSourceWithMemory,
    assertRecordingStopped: async () => {},
    audioDeletion: {
      reconcile: async () => {},
      stage: async () => {
        audioOrder.push('stage');
      },
      restore: async () => {
        audioOrder.push('restore');
      },
      commit: async () => {
        audioOrder.push('commit');
      },
    },
  });
  return { repository, memory, library, audioOrder };
}

test.each([false, true])(
  'a held real transcription service does not block committed deletion (cancel: %s)',
  async cancel => {
    const sourceId = `fresh-provider-${cancel}`;
    const { repository, memory, library, audioOrder } = await harness(sourceId);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    let providerSettled = false;
    const service = createTranscriptEvidenceService({
      loadRepository: openLocalStorage,
      provider: {
        transcribeRecording: async () => {
          entered();
          await held;
          providerSettled = true;
          return providerSuccess({
            text: 'Synthetic speech',
            language: 'ko-KR',
            segments: [
              { text: 'Synthetic speech', startSeconds: 0, endSeconds: 2 },
            ],
            recordingDurationMs: 2000,
            engine: 'dictation_transcriber' as const,
            runtimeVersion: 'test-only',
          });
        },
      },
    });
    const store = getAutomaticTranscriptionStore(service);
    const job = store.start(sourceId);
    try {
      await started;
      await expect(library.deleteRecording(sourceId)).resolves.toEqual({
        audioCleanupPending: false,
      });
      expect(providerSettled).toBe(false);
      expect(await repository.get('source_record', sourceId)).toBeNull();
      expect(audioOrder).toEqual(['stage', 'commit']);
      if (cancel) store.cancel(sourceId);
      release();
      await job;
      // Both cancellation and the production source re-read reject late provider output.
      expect(await repository.transcripts.listForRecording(sourceId)).toEqual(
        [],
      );
    } finally {
      release();
      await job;
      await memory.close();
    }
  },
);

test('warm deletion reuses schema preparation through the production database facade', async () => {
  const first = await harness('facade-cold-recording');
  const second = await harness('facade-warm-recording');
  const execute = jest.spyOn(database, 'execute');
  try {
    await first.library.deleteRecording('facade-cold-recording');
    execute.mockClear();
    await second.library.deleteRecording('facade-warm-recording');
    const repeatedSchema = execute.mock.calls.filter(([sql]) =>
      sql.startsWith('CREATE TABLE IF NOT EXISTS rag_embedding'),
    );
    // The existing warm-cache contract must hold with the app's facade, not only a stable database mock.
    expect(repeatedSchema).toHaveLength(0);
  } finally {
    execute.mockRestore();
    await first.memory.close();
    await second.memory.close();
  }
});

test('completed metadata delivery cannot hold deletion behind the production facade', async () => {
  const sourceId = 'metadata-queue-recording';
  const { repository, memory, library, audioOrder } = await harness(sourceId);
  const gate = holdMetadataResult(repository);
  const listing = library.listSummaries!();
  await gate.entered;
  let settled = false;
  const deletion = library.deleteRecording(sourceId).then(result => {
    settled = true;
    return result;
  });
  try {
    await completeSynchronousSqlWork();
    const completedBeforeRelease = settled;
    gate.release();
    await deletion;
    expect(await listing).toEqual([]);
    expect(completedBeforeRelease).toBe(true);
    expect(audioOrder).toEqual(['stage', 'commit']);
    expect(await repository.get('source_record', sourceId)).toBeNull();
  } finally {
    gate.release();
    await Promise.allSettled([listing, deletion]);
    gate.restore();
    await memory.close();
  }
});
