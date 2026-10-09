import { providerSuccess } from '@orot/model-runtime';
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
import { openLocalStorage } from '../storage/secureDatabase';
import { createPersistentDeletionWorkflow } from './__fixtures__/deletionAwareEvidenceTestSupport';
import {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  return Promise.race([promise.then(() => true), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

describe('deletion-aware concurrent graph resume', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not dispatch the same thread while a newer resume has pending provider work', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-concurrent-resume-'));
    const databasePath = join(directory, 'local.sqlite');
    let opened = openSqliteTestDatabase(databasePath);
    let database: SqlDatabase = opened.database;

    try {
      let repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(
        audioSourceRecord('concurrent-resume-source'),
      );
      const span = await repository.evidenceSpans.create(
        evidenceSpan('concurrent-resume-evidence', source.id, {
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
      const threadId = 'concurrent-resume-run';
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      await persistGraphResumeBoundary(database, reference, threadId);

      opened.close();
      opened = openSqliteTestDatabase(databasePath);
      database = opened.database;
      repository = await openEncryptedStorage(options(database));
      jest.mocked(openLocalStorage).mockResolvedValue(repository);

      const saver = new SqliteCheckpointSaver(
        createLangGraphCheckpointStorage(database),
      );
      const provider = providerFor([]);
      const secondProviderStarted = deferred<void>();
      const releaseProvider = deferred<void>();
      provider.generate.mockImplementation(async () => {
        const call = provider.generate.mock.calls.length;
        if (call === 2) secondProviderStarted.resolve(undefined);
        // Keep the first side effect pending while the competing resume re-reads the thread.
        await releaseProvider.promise;
        return providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: { summary: 'Prepared.' },
            citations: [reference],
          }),
          toolCalls: [],
          finishReason: 'complete',
        });
      });

      const firstValidationStarted = deferred<void>();
      const releaseFirstValidation = deferred<void>();
      const firstRevalidate = jest.fn(async () => {
        firstValidationStarted.resolve(undefined);
        await releaseFirstValidation.promise;
        return true;
      });
      const secondRevalidate = jest.fn(async () => true);
      const firstOptions = createPersistentDeletionWorkflow(
        reference,
        provider.provider,
        saver,
        firstRevalidate,
        async () => evidenceFor(reference),
        threadId,
      );
      const secondOptions = createPersistentDeletionWorkflow(
        reference,
        provider.provider,
        saver,
        secondRevalidate,
        async () => evidenceFor(reference),
        threadId,
      );
      const config = { configurable: { thread_id: threadId } };

      const firstResume = runMultiAgentWorkflow(firstOptions, { config });
      await firstValidationStarted.promise;
      const secondResume = runMultiAgentWorkflow(secondOptions, { config });
      await settlesWithin(secondProviderStarted.promise, 500);
      releaseFirstValidation.resolve(undefined);
      await settlesWithin(secondProviderStarted.promise, 500);
      releaseProvider.resolve(undefined);
      const results = await Promise.all([firstResume, secondResume]);

      expect(provider.generate).toHaveBeenCalledTimes(1);
      expect(results.map(result => result.status)).toContain('stale_evidence');
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
