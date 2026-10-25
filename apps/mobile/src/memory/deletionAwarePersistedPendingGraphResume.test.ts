import {
  runMultiAgentWorkflow,
  SqliteCheckpointSaver,
  type EvidenceReference,
} from '@orot/agent-runtime';
import {
  createLangGraphCheckpointStorage,
  openEncryptedStorage,
} from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import {
  audioSourceRecord,
  evidenceSpan,
  join,
  mkdtempSync,
  options,
  rmSync,
  tmpdir,
} from '../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from '../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { createPersistentDeletionWorkflow } from './__fixtures__/deletionAwareEvidenceTestSupport';
import {
  appendPendingModelCheckpoint,
  evidenceFor,
  persistGraphResumeBoundary,
  providerFor,
} from './__fixtures__/persistentGraphResumeTestSupport';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

jest.mock('../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));

describe('deletion-aware pending graph resume', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a persisted in-flight model operation before evidence callbacks after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-pending-resume-'));
    const databasePath = join(directory, 'local.sqlite');
    let opened = openSqliteTestDatabase(databasePath);
    let database: SqlDatabase = opened.database;

    try {
      let repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(
        audioSourceRecord('pending-resume-source'),
      );
      const span = await repository.evidenceSpans.create(
        evidenceSpan('pending-resume-evidence', source.id, {
          kind: 'audio_time_range',
          startMs: 250,
          endMs: 1800,
        }),
      );
      const reference: EvidenceReference = {
        sourceKind: 'personal_record',
        sourceId: source.id,
        sourceRevision: source.ingestedAt,
        evidenceId: span.id,
        evidenceRevision: span.ingestedAt,
        locator: { kind: 'structured_record', recordId: span.id },
        effectiveTime: span.effectiveAt,
        reviewState: 'unreviewed',
      };
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);

      await persistGraphResumeBoundary(
        database,
        reference,
        'pending-resume-run',
        'pending_model',
      );
      opened.close();
      opened = openSqliteTestDatabase(databasePath);
      database = opened.database;
      repository = await openEncryptedStorage(options(database));
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);

      const provider = providerFor([]);
      const revalidate = jest.fn(async () => true);
      const restore = jest.fn(async () => evidenceFor(reference));
      const pendingSaver = new SqliteCheckpointSaver(
        createLangGraphCheckpointStorage(database),
      );
      const pendingOptions = createPersistentDeletionWorkflow(
        reference,
        provider.provider,
        pendingSaver,
        revalidate,
        restore,
        'pending-resume-run',
      );
      await expect(
        runMultiAgentWorkflow(pendingOptions, {
          config: { configurable: { thread_id: 'pending-resume-run' } },
        }),
      ).resolves.toMatchObject({ status: 'stale_evidence' });
      expect(revalidate).not.toHaveBeenCalled();
      expect(restore).not.toHaveBeenCalled();
      expect(provider.generate).not.toHaveBeenCalled();
    } finally {
      opened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an older safe checkpoint when a newer pending snapshot exists', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-checkpoint-replay-'));
    const databasePath = join(directory, 'local.sqlite');
    let opened = openSqliteTestDatabase(databasePath);
    let database: SqlDatabase = opened.database;

    try {
      let repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(
        audioSourceRecord('checkpoint-replay-source'),
      );
      const span = await repository.evidenceSpans.create(
        evidenceSpan('checkpoint-replay-evidence', source.id, {
          kind: 'audio_time_range',
          startMs: 250,
          endMs: 1800,
        }),
      );
      const reference: EvidenceReference = {
        sourceKind: 'personal_record',
        sourceId: source.id,
        sourceRevision: source.ingestedAt,
        evidenceId: span.id,
        evidenceRevision: span.ingestedAt,
        locator: { kind: 'structured_record', recordId: span.id },
        effectiveTime: span.effectiveAt,
        reviewState: 'unreviewed',
      };
      const threadId = 'checkpoint-replay-run';
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
      const safeCheckpointId = await persistGraphResumeBoundary(
        database,
        reference,
        threadId,
      );
      const snapshots = await appendPendingModelCheckpoint(database, threadId);
      expect(snapshots.safeCheckpointId).toBe(safeCheckpointId);
      expect(snapshots.pendingCheckpointId).not.toBe(safeCheckpointId);
      opened.close();
      opened = openSqliteTestDatabase(databasePath);
      database = opened.database;
      repository = await openEncryptedStorage(options(database));
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);

      const provider = providerFor([]);
      const revalidate = jest.fn(async () => true);
      const restore = jest.fn(async () => evidenceFor(reference));
      const replaySaver = new SqliteCheckpointSaver(
        createLangGraphCheckpointStorage(database),
      );
      const latest = await replaySaver.getTuple({
        configurable: { thread_id: threadId },
      });
      expect(latest?.checkpoint.id).toBe(snapshots.pendingCheckpointId);
      expect(latest?.checkpoint.channel_values.pendingOperation).toMatchObject({
        kind: 'model',
      });
      const replayOptions = createPersistentDeletionWorkflow(
        reference,
        provider.provider,
        replaySaver,
        revalidate,
        restore,
        threadId,
      );
      await expect(
        runMultiAgentWorkflow(replayOptions, {
          config: {
            configurable: {
              thread_id: threadId,
              checkpoint_id: safeCheckpointId,
            },
          },
        }),
      ).resolves.toMatchObject({ status: 'stale_evidence' });
      expect(revalidate).not.toHaveBeenCalled();
      expect(restore).not.toHaveBeenCalled();
      expect(provider.generate).not.toHaveBeenCalled();
    } finally {
      opened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
