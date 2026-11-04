import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../../../ragConversation/conversationSessionRetention';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionReader } from '../conversationSessionReader';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('attaches all saved pages in chronological order and rejects a mid-read deletion', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('saved', await storage.currentGeneration());
    for (const id of ['1', '2', '3'])
      await storage.append({
        id,
        sessionId: 'saved',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: id === '2' ? 'partial' : 'complete',
        question: `question ${id}`,
        answer: `answer ${id}`,
        sources: [],
        citations: [],
      });
    const discovery = createConversationArtifactDiscovery({
      database: connection.database,
      storage,
      registry: new LocalEvidenceReferenceRegistry(),
      data: localData([]).data,
    });
    const reader = createConversationSessionReader(discovery, 1);
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'new-turn',
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({
      retention,
      restoreSession: reader,
    });
    const id = await store.attachExisting(
      'saved',
      0,
      '2026-10-05T00:00:00.000Z',
    );
    expect(
      store
        .getSnapshot()
        .sessions.find(item => item.id === id)
        ?.messages.map(item => item.content),
    ).toEqual([
      'question 1',
      'answer 1',
      'question 2',
      'answer 2',
      'question 3',
      'answer 3',
    ]);
    expect(
      store.getSnapshot().sessions.find(item => item.id === id)?.messages[3],
    ).toMatchObject({ completion: 'partial' });
    store.dispose();

    let pages = 0;
    const racing = createConversationSessionReader(
      {
        ...discovery,
        async readSession(request) {
          const page = await discovery.readSession(request);
          if (++pages === 2)
            await connection.database.execute(
              'DELETE FROM conversation_artifacts WHERE id = ?',
              ['3'],
            );
          return page;
        },
      },
      1,
    );
    await expect(racing('saved', new AbortController().signal)).rejects.toThrow(
      'changed',
    );
  } finally {
    connection.close();
  }
});

test('checks an empty session lease in the same final snapshot', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('empty', await storage.currentGeneration());
    const discovery = createConversationArtifactDiscovery({
      database: connection.database,
      storage,
      registry: new LocalEvidenceReferenceRegistry(),
      data: localData([]).data,
    });
    const reader = createConversationSessionReader({
      ...discovery,
      async revalidateSession(id, version, items, signal) {
        await storage.hideSession(id, version);
        return discovery.revalidateSession(id, version, items, signal);
      },
    });
    await expect(
      reader('empty', new AbortController().signal),
    ).rejects.toThrow();
  } finally {
    connection.close();
  }
});
