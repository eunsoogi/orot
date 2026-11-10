import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { waitFor } from '@testing-library/react-native';
import { subscribeLocalSourceDeletion } from '../../storage/localDataClearEvents';
import { commitHealthKitChanges } from '../../healthkit/commitHealthKitChanges';

test('source removal immediately hides loaded answers and restores only surviving turns', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('saved', await storage.currentGeneration());
    const common = {
      sessionId: 'saved',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      citations: [],
    };
    await storage.append({
      ...common,
      id: 'affected',
      createdAt: '2026-10-05T00:00:00.000Z',
      question: 'private question',
      answer: 'private answer',
      sources: f.saved.sources,
    });
    await storage.append({
      ...common,
      id: 'unaffected',
      createdAt: '2026-10-05T00:00:01.000Z',
      question: 'other question',
      answer: 'other answer',
      sources: [],
    });
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'new',
      now: () => new Date().toISOString(),
    });
    const store = createConversationSessions({
      retention,
      restoreSession: async id =>
        Promise.all(
          (await storage.list(id)).items.map(async item => {
            const turn = (await storage.read(item.id))!;
            return {
              question: turn.question,
              answer: turn.answer,
              citations: [],
            };
          }),
        ),
    });
    const id = await store.attachExisting(
      'saved',
      0,
      '2026-10-05T00:00:00.000Z',
    );
    store.setDraft(id, 'keep draft');
    const unsubscribe = subscribeLocalSourceDeletion(
      store.refreshAfterSourceDeletion,
    );
    try {
      await commitHealthKitChanges(f.repository, async writer =>
        Number(await writer.delete('health_observation', f.inside.id)),
      );
    } finally {
      unsubscribe();
    }
    expect(
      store.getSnapshot().sessions.find(session => session.id === id)?.messages,
    ).toEqual([]);
    await waitFor(() =>
      expect(
        store
          .getSnapshot()
          .sessions.find(session => session.id === id)
          ?.messages.map(message => message.content),
      ).toEqual(['other question', 'other answer']),
    );
    expect(
      store.getSnapshot().sessions.find(session => session.id === id)?.draft,
    ).toBe('keep draft');
    store.dispose();
  } finally {
    f.close();
  }
});
