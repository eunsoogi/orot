import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('a reopened request restores its question as interrupted without starting a provider', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-request-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    let storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-11-13T00:00:00.000Z',
    });
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    const registry = new LocalEvidenceReferenceRegistry();
    const data = localData([]).data;
    const options = createConversationSessionOptions({
      registry,
      loadLocalData: async () => ({
        ...data,
        openConversationArtifactStorage: async () => storage,
        conversationArtifactDiscovery: async () =>
          createConversationArtifactDiscovery({
            database: connection.database,
            storage,
            registry,
            data,
          }),
      }),
    });
    expect((await options.listSessions!()).items).toMatchObject([
      { id: 'session' },
    ]);
    expect(
      await options.restoreSession!('session', new AbortController().signal),
    ).toMatchObject([
      {
        question: 'Synthetic question',
        answer: '',
        completion: 'partial',
        toolMessageId: 'request',
      },
    ]);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
