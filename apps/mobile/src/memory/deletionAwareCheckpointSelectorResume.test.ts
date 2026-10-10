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

describe('deletion-aware checkpoint selector resume', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a root checkpoint-map selector that differs from the validated latest snapshot', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'orot-checkpoint-map-resume-'),
    );
    const databasePath = join(directory, 'local.sqlite');
    let opened = openSqliteTestDatabase(databasePath);
    let database: SqlDatabase = opened.database;

    try {
      let repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(
        audioSourceRecord('checkpoint-map-source'),
      );
      const span = await repository.evidenceSpans.create(
        evidenceSpan('checkpoint-map-evidence', source.id, {
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
      const threadId = 'checkpoint-map-resume-run';
      jest.mocked(openLocalStorage).mockResolvedValue(repository);
      await persistGraphResumeBoundary(database, reference, threadId);

      const seedSaver = new SqliteCheckpointSaver(
        createLangGraphCheckpointStorage(database),
      );
      const latest = await seedSaver.getTuple({
        configurable: { thread_id: threadId },
      });
      const olderId = latest?.parentConfig?.configurable?.checkpoint_id;
      expect(olderId).toBeDefined();
      expect(latest?.checkpoint.channel_values).toMatchObject({
        phase: 'revised_response',
        terminal: false,
      });

      opened.close();
      opened = openSqliteTestDatabase(databasePath);
      database = opened.database;
      repository = await openEncryptedStorage(options(database));
      jest.mocked(openLocalStorage).mockResolvedValue(repository);

      const provider = providerFor([]);
      const revalidate = jest.fn(async () => true);
      const restore = jest.fn(async () => evidenceFor(reference));
      const resumeSaver = new SqliteCheckpointSaver(
        createLangGraphCheckpointStorage(database),
      );
      // getState reads checkpoint_id; graph.invoke separately resolves checkpoint_map[''].
      const config = {
        configurable: {
          thread_id: threadId,
          checkpoint_map: { '': olderId },
        },
      };
      const resumeOptions = createPersistentDeletionWorkflow(
        reference,
        provider.provider,
        resumeSaver,
        revalidate,
        restore,
        threadId,
      );

      const result = await runMultiAgentWorkflow(resumeOptions, { config });
      expect({
        status: result.status,
        revalidationCalls: revalidate.mock.calls.length,
        restorationCalls: restore.mock.calls.length,
        providerCalls: provider.generate.mock.calls.length,
      }).toEqual({
        status: 'stale_evidence',
        revalidationCalls: 0,
        restorationCalls: 0,
        providerCalls: 0,
      });
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
