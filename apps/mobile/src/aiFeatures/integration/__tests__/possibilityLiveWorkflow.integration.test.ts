import { runMigrations } from '@orot/storage';
import { providerSuccess, providerFailure } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createRagConversationService } from '../ragConversationService';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { localData } from '../featureServiceFixtures';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

/** Actual live service, graph and SQLite; provider content and local records are synthetic. */
test.each(['unavailable', 'unexpected', 'cancelled'] as const)(
  'preserves the live possibility boundary after opening (%s)',
  async mode => {
    const opened = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(opened.database);
      const artifacts = createConversationArtifactStorage(opened.database);
      await artifacts.createSession(
        'session',
        await artifacts.currentGeneration(),
      );
      const identity = {
        requestId: 'request',
        sessionId: 'session',
        sessionVersion: 0,
      };
      const question = '검토할 가능성과 부족한 정보를 설명해 주세요.';
      await artifacts.startRequest({
        ...identity,
        id: identity.requestId,
        question,
        createdAt: '2026-11-16T00:00:00.000Z',
      });
      const f = publicEvidenceFixture();
      const controller = new AbortController();
      f.search.mockResolvedValue(
        providerFailure({
          code: 'provider_unavailable',
          message: 'synthetic',
          retryable: true,
        }),
      );
      if (mode === 'unexpected')
        f.search.mockRejectedValue(new Error('synthetic unknown dispatch'));
      if (mode === 'cancelled')
        f.search.mockImplementation(async () => {
          controller.abort();
          return providerFailure({
            code: 'provider_unavailable',
            message: 'synthetic',
            retryable: true,
          });
        });
      const output = (text: string) =>
        providerSuccess({
          text,
          toolCalls: [],
          finishReason: 'complete' as const,
        });
      const generate = jest
        .fn()
        .mockResolvedValueOnce(
          output('요청하신 가능성과 확인할 정보를 살펴볼게요.'),
        )
        .mockResolvedValueOnce(output('ALLOW'))
        .mockResolvedValue(
          output(
            JSON.stringify({
              type: 'result',
              value: {
                answerKind: 'conversation',
                answer: '어떤 증상이 있었는지 알려주시겠어요?',
              },
              citations: [],
            }),
          ),
        );
      const selected = {
        ...f.selected,
        provider: {
          ...f.selected.provider,
          generate,
          stream: undefined,
          capabilities: {
            ...f.selected.provider.capabilities,
            streaming: false,
          },
        },
      };
      const data = localData([]).data;
      data.openConversationArtifactStorage = async () => artifacts;
      const send = createRagConversationService({
        selectedAi: async () => selected,
        consent: f.consent,
        queryConsent: { authorize: async () => 'authorized' },
        externalEvidence: {
          search: jest.fn(async () => ({ status: 'empty' as const })),
        },
        loadLocalData: async () => data,
        registry: new LocalEvidenceReferenceRegistry(),
        ragRunner: runRagConversationTurn,
      });
      const events: unknown[] = [];
      const result = await send(
        question,
        [],
        controller.signal,
        {
          retentionRequestId: identity.requestId,
          retentionSession: {
            id: identity.sessionId,
            version: identity.sessionVersion,
          },
          openWorkflowContinuation: (owner, reconstruct) =>
            artifacts.openWorkflowContinuation(owner, reconstruct),
          onWorkflowPauseController: () => {},
          onWorkflowPaused: async () => false,
          onTaskStreamEvent: event => events.push(event),
        },
        { intent: 'possibilities', entryKey: 'synthetic-possibility' },
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'initial_response' }),
      );
      if (mode === 'unavailable') {
        expect(result).toMatchObject({
          status: 'answer',
          answer: expect.stringContaining('증상'),
        });
        expect(generate).toHaveBeenCalledTimes(3);
      } else {
        expect(result).toEqual({
          status: 'failure',
          kind: mode === 'cancelled' ? 'cancelled' : 'unavailable',
        });
        expect(generate).toHaveBeenCalledTimes(2);
      }
      expect(f.search).toHaveBeenCalledTimes(1);
    } finally {
      opened.close();
    }
  },
);
