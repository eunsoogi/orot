import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import type { AiFeatureLocalData } from '../localData';

test('app restoration hydrates only recent ten turns then fetches older protected pages without losing records', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('saved', await storage.currentGeneration());
    for (let index = 0; index < 25; index++) {
      const id = String(index).padStart(2, '0');
      await storage.append({
        id,
        sessionId: 'saved',
        createdAt: '2026-11-01T00:00:00.000Z',
        providerId: 'synthetic',
        modelId: 'synthetic',
        status: 'complete',
        question: `question ${id}`,
        answer: `answer ${id}`,
        sources: [],
        citations: [],
      });
    }
    const registry = new LocalEvidenceReferenceRegistry();
    let hydrated = 0;
    let deleteDuringRead = false;
    const data: AiFeatureLocalData = {
      ...localData([]).data,
      openConversationArtifactStorage: async () => storage,
      conversationArtifactDiscovery: async () => {
        const discovery = createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          registry,
          data,
        });
        return {
          ...discovery,
          readSession: async request => {
            expect(request.ids?.length).toBeLessThanOrEqual(10);
            const page = await discovery.readSession(request);
            hydrated += page.items.length;
            if (deleteDuringRead) await storage.deleteSession('saved');
            return page;
          },
        };
      },
    };
    const options = createConversationSessionOptions({
      loadLocalData: async () => data,
      registry,
    });
    const store = createConversationSessions(options);
    const id = await store.attachExisting(
      'saved',
      0,
      '2026-11-01T00:00:00.000Z',
    );
    const session = () =>
      store.getSnapshot().sessions.find(value => value.id === id)!;
    expect(session().restoreFailed).toBe(false);
    expect(hydrated).toBe(10);
    expect(session().messages).toHaveLength(20);
    expect(session().messages[0]?.content).toBe('question 15');
    const stable = session().messages.map(message => message.id);
    await store.loadOlderHistory(id!);
    expect(hydrated).toBe(20);
    expect(
      session()
        .messages.slice(-20)
        .map(message => message.id),
    ).toEqual(stable);
    await store.loadOlderHistory(id!);
    expect(hydrated).toBe(25);
    expect(session().historyHasMore).toBe(false);
    expect(session().messages).toHaveLength(50);
    expect((await storage.list('saved')).items).toHaveLength(25);
    store.dispose();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      options.restoreSessionPage!('saved', cancelled.signal),
    ).rejects.toThrow();
    deleteDuringRead = true;
    await expect(
      options.restoreSessionPage!('saved', new AbortController().signal),
    ).rejects.toThrow();
  } finally {
    connection.close();
  }
});
