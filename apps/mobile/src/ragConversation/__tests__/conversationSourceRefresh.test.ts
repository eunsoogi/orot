import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { waitFor } from '@testing-library/react-native';
import {
  notifyLocalSourceDeleted,
  subscribeLocalSourceDeletion,
} from '../../storage/localDataClearEvents';
import { commitHealthKitChanges } from '../../healthkit/commitHealthKitChanges';

test.each(['local', 'healthkit'] as const)(
  '%s removal hides affected answers while preserving the user draft',
  async origin => {
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
      expect((await storage.read('affected'))?.answer).toBe('private answer');
      const retention = createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => 'new',
        now: () => new Date().toISOString(),
      });
      const store = createConversationSessions({
        retention,
        restoreSession: async id => {
          const result = [];
          for (const item of (await storage.list(id)).items) {
            const turn = await storage.read(item.id);
            if (turn)
              result.push({
                question: turn.question,
                answer: turn.answer,
                citations: [],
                healthSources: turn.sources.length ? (true as const) : [],
              });
          }
          return result;
        },
      });
      const id = await store.attachExisting(
        'saved',
        0,
        '2026-10-05T00:00:00.000Z',
      );
      const readMessages = () =>
        store
          .getSnapshot()
          .sessions.find(session => session.id === id)
          ?.messages.map(message => message.content);
      expect(readMessages()).toEqual(
        expect.arrayContaining(['private answer', 'other answer']),
      );
      store.setDraft(id, 'keep draft');
      const unsubscribe = subscribeLocalSourceDeletion(
        store.refreshAfterSourceDeletion,
      );
      try {
        if (origin === 'healthkit') {
          await commitHealthKitChanges(f.repository, async writer =>
            Number(await writer.delete('health_observation', f.inside.id)),
          );
        } else {
          await f.repository.delete('health_observation', f.inside.id);
          notifyLocalSourceDeleted();
        }
      } finally {
        unsubscribe();
      }
      if (origin === 'local') {
        expect(readMessages()).toEqual([]);
        await waitFor(() =>
          expect(readMessages()).toEqual(['other question', 'other answer']),
        );
      } else {
        expect(readMessages()).toHaveLength(3);
        expect(readMessages()).toEqual(
          expect.arrayContaining([
            'private question',
            'other question',
            'other answer',
          ]),
        );
        expect(readMessages()).not.toContain('private answer');
        expect(await storage.read('affected')).toBeNull();
      }
      expect(
        store.getSnapshot().sessions.find(session => session.id === id)?.draft,
      ).toBe('keep draft');
      store.dispose();
    } finally {
      f.close();
    }
  },
);
