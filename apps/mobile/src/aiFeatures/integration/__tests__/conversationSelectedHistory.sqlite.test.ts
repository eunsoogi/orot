import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { loadConversationHistory } from '../conversationHistorySources';
import { localData } from '../featureServiceFixtures';
import { createRagConversationService } from '../ragConversationService';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

// An unreadable older neighbor is not a selected input to the current request.
test.each([
  'valid',
  'corrupt',
  'deleted',
  'deleted-with-valid-neighbor',
  'session-deleted',
  'aborted',
  'owner-revoked-during-consent',
  'abort-during-consent',
] as const)(
  'isolates unrelated history while preserving selected %s guards',
  async state => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      const storage = createConversationArtifactStorage(db.database);
      await storage.createSession('session', await storage.currentGeneration());
      for (const id of ['selected', 'unrelated', 'current']) {
        await storage.append({
          id,
          sessionId: 'session',
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
      await db.database.execute(
        'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
        ['{}', 'unrelated'],
      );
      const registry = new LocalEvidenceReferenceRegistry();
      const data = localData([]).data;
      const discovery = createConversationArtifactDiscovery({
        database: db.database,
        storage,
        registry,
        data,
      });
      Object.assign(data, {
        conversationArtifactDiscovery: async () => discovery,
      });
      expect(
        (
          await discovery.readSession({
            sessionId: 'session',
            signal: new AbortController().signal,
          })
        ).unavailableCount,
      ).toBe(1);
      if (state === 'corrupt')
        await db.database.execute(
          'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
          ['{}', 'selected'],
        );
      const races =
        state === 'owner-revoked-during-consent' ||
        state === 'abort-during-consent';
      if (
        state === 'deleted' ||
        state === 'deleted-with-valid-neighbor' ||
        races
      )
        await db.database.execute(
          'DELETE FROM conversation_artifacts WHERE id = ?',
          ['selected'],
        );
      if (state === 'session-deleted') await storage.deleteSession('session');
      const controller = new AbortController();
      if (state === 'aborted') controller.abort();
      const pending = loadConversationHistory({
        messages: [],
        session: { id: 'session', version: 0 },
        retainedHistory: [{ id: 'selected', question: 'question selected' }],
        data,
        registry,
        signal: controller.signal,
      });
      if (state !== 'valid') await expect(pending).rejects.toThrow();
      else {
        const history = await pending;
        expect(history.priorTurns).toEqual([
          {
            question: registry.redactText('question selected'),
            answer: registry.redactText('answer selected'),
          },
        ]);
        expect(history.references).toHaveLength(1);
        expect(history.omitted).toBe(false);
      }
      // All these entry choices share the same protected history preparation.
      const fixture = publicEvidenceFixture();
      if (races)
        fixture.authorize.mockImplementation(async () => {
          if (state === 'owner-revoked-during-consent')
            await storage.deleteSession('session');
          else controller.abort();
          return 'authorized';
        });
      const ragRunner = jest.fn(runRagConversationTurn);
      const generate = jest.fn(async (_: LanguageModelRequest) =>
        providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: { answerKind: 'conversation', answer: '안녕하세요.' },
            citations: [],
          }),
          toolCalls: [],
          finishReason: 'complete' as const,
        }),
      );
      const send = createRagConversationService({
        consent: fixture.consent,
        queryConsent: { authorize: async () => 'authorized' },
        externalEvidence: { search: jest.fn() },
        loadLocalData: async () => data,
        selectedAi: async () => ({
          ...fixture.selected,
          provider: {
            ...fixture.selected.provider,
            searchPublicWeb: undefined,
            generate,
            capabilities: {
              ...fixture.selected.provider.capabilities,
              streaming: false,
              structuredOutput: false,
              toolCalling: false,
            },
          },
        }),
        registry,
        ragRunner,
      });
      const omits =
        state === 'corrupt' ||
        state === 'deleted' ||
        state === 'deleted-with-valid-neighbor';
      const hasNeighbor = state === 'deleted-with-valid-neighbor';
      const originalHistory = [
        { role: 'user' as const, content: 'question selected' },
      ];
      const retainedHistory = [
        { id: 'selected', question: 'question selected' },
      ];
      if (hasNeighbor) {
        originalHistory.push({ role: 'user', content: 'question current' });
        retainedHistory.push({ id: 'current', question: 'question current' });
      }
      for (const intent of [
        'possibilities',
        'visit-questions',
        'health-summary',
        'conversation',
      ] as const) {
        const outcome = await send(
          '안녕하세요',
          originalHistory,
          controller.signal,
          {
            retentionSession: { id: 'session', version: 0 },
            retainedHistory,
          },
          intent === 'conversation' ? undefined : { intent, entryKey: intent },
        );
        expect(outcome).toMatchObject({
          status:
            state === 'valid' || (intent === 'conversation' && omits)
              ? 'answer'
              : 'failure',
        });
        if (intent === 'conversation' && omits)
          expect(outcome).toMatchObject({
            answer: expect.stringContaining(
              '확인할 수 없는 일부 이전 대화는 답변에 반영하지 않았어요.',
            ),
          });
      }
      if (omits) {
        expect(ragRunner).toHaveBeenCalledTimes(1);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(generate.mock.calls[0]?.[0])).not.toMatch(
          /(?:question|answer) selected/,
        );
        expect(ragRunner.mock.calls[0]?.[0]).toMatchObject({
          question: '안녕하세요',
          previousMessages: hasNeighbor
            ? [
                {
                  role: 'user',
                  content: registry.redactText('question current'),
                },
              ]
            : [],
          validatedPriorTurns: hasNeighbor
            ? [
                {
                  question: registry.redactText('question current'),
                  answer: registry.redactText('answer current'),
                },
              ]
            : [],
          priorDialogueOmitted: true,
        });
        if (hasNeighbor)
          expect((await storage.read('current'))?.answer).toBe(
            'answer current',
          );
        expect(originalHistory[0]?.content).toBe('question selected');
      } else {
        expect(ragRunner).toHaveBeenCalledTimes(
          state === 'valid' ? 4 : races ? 1 : 0,
        );
        expect(generate).toHaveBeenCalledTimes(state === 'valid' ? 4 : 0);
        if (races) expect(fixture.authorize).toHaveBeenCalledTimes(1);
      }
    } finally {
      db.close();
    }
  },
);
