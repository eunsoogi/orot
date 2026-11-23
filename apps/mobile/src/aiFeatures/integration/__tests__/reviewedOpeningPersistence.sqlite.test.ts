import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { standardSearchFixture } from '../../../../../../packages/agent-runtime/__tests__/multiAgent-standard-search-fixtures';
import { providerSuccess } from '@orot/model-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { reportObservation } from '../testSupport/dailyReportFailureStageFixtures';
import { conversationSavedHistoryDisplayOption } from '../conversationSavedHistoryDisplayOption';
import {
  prependSavedHistoryDisplay,
  savedHistoryTranscript,
} from '../../../ragConversation/conversationSavedHistoryDisplay';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from '../../../ragConversation/conversationTurnRetention';
import { createConversationTurnActivity } from '../../../ragConversation/conversationTurnActivity';
import { createEmptyConversation } from '../../../ragConversation/conversationEmptySession';
import type { ConversationSession } from '../../../ragConversation/conversationSessionTypes';
import { startContextualConversationOpening } from '../contextualConversationOpening';
import type { SelectedAiResolution } from '../provider';

const synthetic = {
  id: 'reviewed-opening',
  owner: 'owner',
  question: '합성 질문을 더 살펴봐 줘',
  text: '요청하신 내용을 함께 살펴볼게요.',
  at: '2026-11-23T08:00:00.000Z',
};

test.each(['user-stop', 'cold-restart'] as const)(
  'an approved opening survives %s until a real deletion',
  async mode => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      const records = createRecordRepository(db.database);
      await records.put('health_observation', reportObservation);
      const storage = createConversationArtifactStorage(db.database);
      await storage.createSession(
        synthetic.owner,
        await storage.currentGeneration(),
      );
      let writeDuration: number | undefined;
      const retained = createConversationTurnRetention({
        storage: {
          ...storage,
          async writeReviewedOpening(input) {
            const start = performance.now();
            try {
              await storage.writeReviewedOpening(input);
            } finally {
              writeDuration = performance.now() - start;
            }
          },
        },
        sessionId: synthetic.owner,
        turnId: synthetic.id,
        createdAt: synthetic.at,
      });
      const lifetime = new AbortController();
      await retained.startRequest(synthetic.question, lifetime.signal);
      let session: ConversationSession = {
        ...createEmptyConversation(1),
        pendingMessage: {
          id: 2,
          content: '',
          activity: '',
        },
      };
      const activity = createConversationTurnActivity({
        id: 1,
        responseId: 2,
        find: () => session,
        update: (_id, change) => {
          session = { ...session, ...change };
        },
        current: () => !lifetime.signal.aborted,
        retained,
      });
      const f = standardSearchFixture(true);
      for (const text of [synthetic.text, 'ALLOW']) {
        f.provider.generate.mockResolvedValueOnce(
          providerSuccess({
            text,
            toolCalls: [],
            finishReason: 'complete',
          }),
        );
      }
      const work = startContextualConversationOpening({
        selected: {
          status: 'ready',
          provider: f.provider,
          modelId: f.options.execution.modelId,
          recipient: f.options.execution.recipient,
          remoteProcessing: true,
        } as unknown as Extract<SelectedAiResolution, { status: 'ready' }>,
        request: synthetic.question,
        observer: activity.observer,
        consent: f.options.consent,
        consentScope: f.options.execution.consentScope,
        signal: lifetime.signal,
      });
      await work.done;
      expect(writeDuration).toBeDefined();
      expect(session.pendingMessage).toMatchObject({
        initialResponse: { text: synthetic.text },
      });
      lifetime.abort();
      if (mode === 'user-stop')
        await retained.interruptRequest('interrupted', 'user-stopped');
      const reopened = createConversationArtifactStorage(db.database);
      if (mode === 'cold-restart') await reopened.interruptRecoveredRequests();
      expect(await reopened.read(synthetic.id)).toBeNull();
      expect(await reopened.listCompletionIdentities()).toEqual([]);
      expect(
        await reopened.readSessionPresentationMany(synthetic.owner, 0, [
          synthetic.id,
        ]),
      ).toMatchObject([
        {
          status: 'opening',
          question: synthetic.question,
          initialResponse: { text: synthetic.text },
        },
      ]);
      const signal = new AbortController().signal;
      const display = conversationSavedHistoryDisplayOption(
        async () => reopened,
      );
      const saved = await display(synthetic.owner, 0, signal);
      let id = 0;
      const messages = savedHistoryTranscript(
        prependSavedHistoryDisplay(saved.rows, [], () => --id),
        [],
      );
      expect(messages.map(x => x.role)).toEqual(['user', 'assistant']);
      expect(messages[1]).toMatchObject({
        content: '',
        initialResponse: { text: synthetic.text },
      });
      expect(messages[1]?.activity).toBeUndefined();

      // Editing an unrelated record changes only mutation, not deletion, authority.
      await records.put('health_observation', {
        ...reportObservation,
        value: { kind: 'quantity', amount: 75, unit: 'count/min' },
      });
      expect((await display(synthetic.owner, 0, signal)).rows[0]?.kind).toBe(
        'opening',
      );

      // Retire the recorded epoch in the exact awaited gap after SQLite returns a body.
      const interrupted = conversationSavedHistoryDisplayOption(async () => ({
        ...reopened,
        async readSessionPresentationMany(...args) {
          const proved = await reopened.readSessionPresentationMany(...args);
          expect(
            await records.delete('health_observation', reportObservation.id),
          ).toBe(true);
          return proved;
        },
      }));
      await expect(interrupted(synthetic.owner, 0, signal)).rejects.toThrow(
        'Conversation content changed during restoration.',
      );
      const afterDelete = await conversationSavedHistoryDisplayOption(
        async () => createConversationArtifactStorage(db.database),
      )(synthetic.owner, 0, signal);
      expect(afterDelete.rows[0]?.kind).toBe('interrupted');
    } finally {
      db.close();
    }
  },
);
