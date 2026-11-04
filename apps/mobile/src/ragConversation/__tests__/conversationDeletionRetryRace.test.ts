import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';

test.each(['hide-first', 'retry-first', 'commit-first'] as const)(
  'suspends retry during an unresolved hide and settles safely: %s',
  async order => {
    const f = await healthContextFixture();
    try {
      const storage = createConversationArtifactStorage(f.database);
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const started = new Promise<void>(resolve => {
        entered = resolve;
      });
      let attempts = 0;
      let sequence = 0;
      const retention = createConversationSessionRetention({
        openStorage: async () => ({
          ...storage,
          async append(...args) {
            if (++attempts === 1) throw new Error('write failed');
            if (order === 'commit-first' && attempts === 2) {
              await storage.append(...args);
              entered();
              await gate;
              return;
            }
            if (order === 'retry-first' && attempts === 2) {
              entered();
              await gate;
            }
            return storage.append(...args);
          },
          async hideSession() {
            if (order === 'hide-first') {
              entered();
              await gate;
            }
            throw new Error('hide failed before commit');
          },
        }),
        createId: () => `id-${++sequence}`,
        now: () => '2026-10-05T00:00:00.000Z',
      });
      const store = createConversationSessions({
        retention,
        restoreSession: async () => {
          const turn = await storage.read('id-2');
          return turn
            ? [{ question: turn.question, answer: turn.answer, citations: [] }]
            : [];
        },
      });
      store.setDraft(1, 'question');
      await store.send(1, async (_question, _history, signal, observer) => {
        try {
          await observer!.onRetentionCandidate!(
            {
              question: 'question',
              answer: 'answer',
              providerId: 'provider',
              modelId: 'model',
              sources: f.saved.sources,
              citations: [f.saved.sources[0]!.reference],
            },
            signal!,
          );
        } catch {
          observer!.onRetentionFailure!();
        }
        return { status: 'answer', answer: 'answer', citations: [] };
      });
      if (order === 'hide-first') {
        const removing = store.remove(1);
        await started;
        await store.retrySave(1);
        expect(attempts).toBe(1);
        release();
        await removing;
      } else {
        const retry = store.retrySave(1);
        await started;
        await store.remove(1);
        release();
        await retry;
        expect(store.getSnapshot().sessions[0]?.retryingSave).toBe(false);
        if (order === 'commit-first')
          expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(0);
      }
      await store.retrySave(1);
      expect((await storage.read('id-2'))?.answer).toBe('answer');
      expect(
        store.getSnapshot().sessions[0]?.messages.map(item => item.content),
      ).toEqual(['question', 'answer']);
    } finally {
      f.close();
    }
  },
);
