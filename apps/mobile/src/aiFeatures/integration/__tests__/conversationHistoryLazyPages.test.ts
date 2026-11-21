import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { savedHistoryTranscript } from '../../../ragConversation/conversationSavedHistoryDisplay';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import type { AiFeatureLocalData } from '../localData';

test('app restoration pages committed text in batches of ten without hydrating evidence', async () => {
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
    const pageSizes: number[] = [];
    const hydrate = jest.fn(async () => {
      throw new Error('Archive hydrated old sources.');
    });
    let deleteDuringRead = false;
    const data: AiFeatureLocalData = {
      ...localData([]).data,
      openConversationArtifactStorage: async () => ({
        ...storage,
        async readSessionPresentationMany(sessionId, version, ids) {
          pageSizes.push(ids.length);
          const result = await storage.readSessionPresentationMany(
            sessionId,
            version,
            ids,
          );
          if (deleteDuringRead) await storage.deleteSession('saved');
          return result;
        },
      }),
      conversationArtifactDiscovery: hydrate,
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
    const transcript = () =>
      savedHistoryTranscript(
        session().savedHistoryDisplay ?? [],
        session().messages,
      );
    expect(pageSizes).toEqual([10]);
    expect(transcript()).toHaveLength(20);
    expect(transcript()[0]?.content).toBe('question 15');
    const stable = transcript().map(message => message.id);
    await store.loadOlderHistory(id!);
    expect(pageSizes).toEqual([10, 10]);
    expect(
      transcript()
        .slice(-20)
        .map(message => message.id),
    ).toEqual(stable);
    await store.loadOlderHistory(id!);
    expect(pageSizes).toEqual([10, 10, 5]);
    expect(session().historyHasMore).toBe(false);
    expect(transcript()).toHaveLength(50);
    expect(session().messages).toEqual([]);
    expect(hydrate).not.toHaveBeenCalled();
    expect((await storage.list('saved')).items).toHaveLength(25);
    store.dispose();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      options.readSavedHistoryDisplay!('saved', 0, cancelled.signal),
    ).rejects.toThrow();
    deleteDuringRead = true;
    await expect(
      options.readSavedHistoryDisplay!(
        'saved',
        0,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  } finally {
    connection.close();
  }
});
