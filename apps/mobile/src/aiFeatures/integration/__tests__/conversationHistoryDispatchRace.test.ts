import { runMigrations } from '@orot/storage';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createRagConversationService } from '../ragConversationService';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { loadConversationHistory } from '../conversationHistorySources';

test.each([
  [1, 'deleted'],
  [2, 'deleted'],
  [1, 'revised'],
  [2, 'revised'],
] as const)(
  'does not send %s call after retained history is %s',
  async (call, change) => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      const storage = createConversationArtifactStorage(db.database);
      await storage.createSession('session', await storage.currentGeneration());
      await storage.append({
        id: 'turn',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'SYNTHETIC_QUESTION',
        answer: 'SYNTHETIC_PRIVATE_HISTORY',
        sources: [],
        citations: [],
      });
      const registry = new LocalEvidenceReferenceRegistry();
      const data = Object.assign(localData([]).data, {
        openConversationArtifactStorage: async () => storage,
        conversationArtifactDiscovery: async (
          r: LocalEvidenceReferenceRegistry,
        ) =>
          createConversationArtifactDiscovery({
            database: db.database,
            storage,
            data,
            registry: r,
          }),
      });
      const fixture = publicEvidenceFixture();
      await loadConversationHistory({
        messages: [],
        session: { id: 'session', version: 0 },
        retainedHistory: [{ id: 'turn', question: 'SYNTHETIC_QUESTION' }],
        data,
        registry,
        signal: new AbortController().signal,
      });
      let release!: () => void;
      let entered!: () => void;
      const ready = new Promise<void>(resolve => {
        entered = resolve;
      });
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      let consentCount = 0;
      fixture.authorize.mockImplementation(async () => {
        if (++consentCount === call) {
          entered();
          await gate;
        }
        return 'authorized';
      });
      const generate = jest.fn(async (_request: LanguageModelRequest) => {
        if (call === 2 && generate.mock.calls.length === 1)
          return providerSuccess({
            text: '',
            toolCalls: [
              {
                id: 'search',
                name: 'local-personal-records',
                arguments: { query: 'synthetic' },
              },
            ],
            finishReason: 'tool_calls' as const,
          });
        return providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: { answerKind: 'conversation', answer: '확인했어요.' },
            citations: [],
          }),
          toolCalls: [],
          finishReason: 'complete' as const,
        });
      });
      const provider = {
        ...fixture.selected.provider,
        searchPublicWeb: undefined,
      };
      const send = createRagConversationService({
        consent: fixture.consent,
        queryConsent: { authorize: async () => 'authorized' },
        externalEvidence: { search: jest.fn() },
        loadLocalData: async () => data,
        selectedAi: async () => ({
          ...fixture.selected,
          provider: {
            ...provider,
            generate,
            capabilities: {
              ...provider.capabilities,
              streaming: false,
              toolCalling: call === 2,
              structuredOutput: false,
            },
          },
        }),
        registry,
        ragRunner: runRagConversationTurn,
      });
      const pending = send(
        '지난 답을 이어서 알려 주세요',
        [],
        undefined,
        {
          retentionSession: { id: 'session', version: 0 },
          retainedHistory: [{ id: 'turn', question: 'SYNTHETIC_QUESTION' }],
        },
        { intent: 'possibilities', entryKey: 'entry' },
      );
      const start = await Promise.race([
        ready.then(() => 'consent'),
        pending.then(outcome => JSON.stringify(outcome)),
      ]);
      expect(start).toBe('consent');
      if (change === 'deleted') await storage.deleteSession('session');
      else {
        const original = await storage.read('turn');
        if (!original) throw new Error('Missing synthetic turn');
        await db.database.execute(
          'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
          [
            JSON.stringify({
              ...original,
              answer: 'REVISED_SYNTHETIC_HISTORY',
            }),
            'turn',
          ],
        );
      }
      release();
      const outcome = await pending;
      expect(outcome.status).not.toBe('answer');
      if (generate.mock.calls.length >= call)
        expect(JSON.stringify(generate.mock.calls[call - 1]![0])).not.toContain(
          'SYNTHETIC_PRIVATE_HISTORY',
        );
      expect(generate).toHaveBeenCalledTimes(call - 1);
      if (call === 2)
        expect(JSON.stringify(generate.mock.calls[0]![0])).toContain(
          'SYNTHETIC_PRIVATE_HISTORY',
        );
    } finally {
      db.close();
    }
  },
);
