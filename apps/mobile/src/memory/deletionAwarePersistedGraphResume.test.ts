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
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';
import { withLocalDeletionAwareRevalidation } from './deletionAwareEvidenceRevalidation';
import { createPersistentDeletionWorkflow } from './__fixtures__/deletionAwareEvidenceTestSupport';
import {
  evidenceFor,
  persistGraphResumeBoundary,
  providerFor,
  removePersistedSourceThroughApplicationPath,
} from './__fixtures__/persistentGraphResumeTestSupport';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

jest.mock('../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));

describe('deletion-aware persisted graph resume', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resumes live SQLite checkpoints, preserves cancellation, and rejects deleted references after reopen', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'orot-persisted-delete-resume-'),
    );
    const databasePath = join(directory, 'local.sqlite');
    let opened = openSqliteTestDatabase(databasePath);
    let database: SqlDatabase = opened.database;

    try {
      let repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(
        audioSourceRecord('persisted-resume-source'),
      );
      const span = await repository.evidenceSpans.create(
        evidenceSpan('persisted-resume-evidence', source.id, {
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

      await persistGraphResumeBoundary(database, reference, 'live-resume-run');
      opened.close();
      opened = openSqliteTestDatabase(databasePath);
      database = opened.database;
      repository = await openEncryptedStorage(options(database));
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);

      const liveSaver = new SqliteCheckpointSaver(
        createLangGraphCheckpointStorage(database),
      );
      // A cancelled restart must not inspect health evidence after the caller stops the run.
      const cancelledSignal = new AbortController();
      cancelledSignal.abort();
      jest.mocked(openLocalStorage).mockClear();
      const cancelledProvider = providerFor([]);
      const cancelledRevalidate = jest.fn(async () => true);
      const cancelledRestore = jest.fn(async () => evidenceFor(reference));
      const guardedRevalidate =
        withLocalDeletionAwareRevalidation(cancelledRevalidate);
      await expect(
        guardedRevalidate([reference], cancelledSignal.signal),
      ).resolves.toBe(false);
      expect(openLocalStorage).not.toHaveBeenCalled();

      const cancelledOptions = createPersistentDeletionWorkflow(
        reference,
        cancelledProvider.provider,
        liveSaver,
        cancelledRevalidate,
        cancelledRestore,
        'live-resume-run',
      );
      await expect(
        runMultiAgentWorkflow(cancelledOptions, {
          config: { configurable: { thread_id: 'live-resume-run' } },
          signal: cancelledSignal.signal,
        }),
      ).resolves.toMatchObject({ status: 'cancelled' });
      expect(openLocalStorage).not.toHaveBeenCalled();
      expect(cancelledRevalidate).not.toHaveBeenCalled();
      expect(cancelledRestore).not.toHaveBeenCalled();
      expect(cancelledProvider.generate).not.toHaveBeenCalled();
      await expect(
        repository.get('source_record', source.id),
      ).resolves.not.toBeNull();

      const liveProvider = providerFor([
        JSON.stringify({
          type: 'result',
          value: { summary: 'Prepared.' },
          citations: [reference],
        }),
      ]);
      const liveRestore = jest.fn(async () => evidenceFor(reference));
      const liveRevalidate = jest.fn(async () => true);
      const liveOptions = createPersistentDeletionWorkflow(
        reference,
        liveProvider.provider,
        liveSaver,
        liveRevalidate,
        liveRestore,
        'live-resume-run',
      );
      await expect(
        runMultiAgentWorkflow(liveOptions, {
          config: { configurable: { thread_id: 'live-resume-run' } },
        }),
      ).resolves.toMatchObject({ status: 'result' });
      expect(liveRevalidate).toHaveBeenCalledWith(
        [reference],
        expect.any(AbortSignal),
      );
      expect(liveRestore).toHaveBeenCalledTimes(1);
      expect(liveProvider.generate).toHaveBeenCalledTimes(1);

      await persistGraphResumeBoundary(
        database,
        reference,
        'deleted-resume-run',
      );
      const deletion = await removePersistedSourceThroughApplicationPath(
        database,
        repository,
        source.id,
        span.id,
      );
      expect(deletion).toEqual({ sourceDeleted: true, memoriesDeleted: 1 });
      opened.close();
      opened = openSqliteTestDatabase(databasePath);
      database = opened.database;
      repository = await openEncryptedStorage(options(database));
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
      await expect(
        repository.get('source_record', source.id),
      ).resolves.toBeNull();
      await expect(
        repository.listDeletedSourceReferenceIds([source.id]),
      ).resolves.toContain(source.id);
      await expect(
        new SqlCipherAgentMemoryStorage(database).listRecords(),
      ).resolves.toEqual([]);

      const deletedLookup = jest.spyOn(
        repository,
        'listDeletedSourceReferenceIds',
      );
      const deletedSaver = new SqliteCheckpointSaver(
        createLangGraphCheckpointStorage(database),
      );
      const deletedProvider = providerFor([
        JSON.stringify({
          type: 'result',
          value: { summary: 'Prepared.' },
          citations: [reference],
        }),
      ]);
      const deletedRestore = jest.fn(async () => evidenceFor(reference));
      const deletedRevalidate = jest.fn(async () => true);
      const deletedOptions = createPersistentDeletionWorkflow(
        reference,
        deletedProvider.provider,
        deletedSaver,
        deletedRevalidate,
        deletedRestore,
        'deleted-resume-run',
      );
      await expect(
        runMultiAgentWorkflow(deletedOptions, {
          config: { configurable: { thread_id: 'deleted-resume-run' } },
        }),
      ).resolves.toMatchObject({ status: 'stale_evidence' });
      expect(deletedLookup).toHaveBeenCalledWith([source.id, span.id]);
      expect(deletedRevalidate).not.toHaveBeenCalled();
      expect(deletedRestore).not.toHaveBeenCalled();
      expect(deletedProvider.generate).not.toHaveBeenCalled();
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
