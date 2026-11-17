import { runMigrations } from '@orot/storage';
import { providerSuccess, providerFailure } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createRagConversationService } from '../ragConversationService';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { localData, memoryRecord } from '../featureServiceFixtures';
import { openLocalAgentMemoryDatabase } from '../../../storage/secureDatabase';

jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

/** Actual live service, graph and SQLite; provider content and local records are synthetic. */
test.each([
  'unavailable',
  'grounded',
  'grounded-denied',
  'grounded-changed',
  'unexpected',
  'cancelled',
] as const)(
  'preserves the live possibility boundary after opening (%s)',
  async mode => {
    const opened = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(opened.database);
      jest
        .mocked(openLocalAgentMemoryDatabase)
        .mockResolvedValue(opened.database);
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
      const grounded = mode.startsWith('grounded');
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
      if (grounded) {
        // Keep the actual durable graph, local tool, alias and citation validators.
        // Only provider output and memory retrieval are synthetic.
        generate
          .mockReset()
          .mockResolvedValueOnce(output('요청하신 내용을 살펴볼게요.'))
          .mockResolvedValueOnce(output('ALLOW'))
          .mockResolvedValueOnce(
            providerSuccess({
              text: '',
              finishReason: 'tool_calls' as const,
              toolCalls: [
                {
                  id: 'local-read',
                  name: 'local-reviewed-memory',
                  arguments: { query: '합성 기억' },
                },
              ],
            }),
          )
          .mockImplementation(
            async (
              request: import('@orot/model-runtime').LanguageModelRequest,
            ) => {
              const evidence = request.messages.flatMap(message => {
                if (
                  message.role !== 'user' ||
                  typeof message.content !== 'string'
                )
                  return [];
                try {
                  const value = JSON.parse(message.content);
                  return Array.isArray(value.evidence) ? value.evidence : [];
                } catch {
                  return [];
                }
              });
              expect(evidence.length).toBeGreaterThan(0);
              return output(
                JSON.stringify({
                  type: 'result',
                  value: {
                    answerKind: 'grounded',
                    completion: 'partial',
                    answer:
                      '저장된 합성 기억을 확인했어요. 공개 자료는 확인하지 못했어요.',
                  },
                  citations: evidence.map(item => item.evidenceId),
                }),
              );
            },
          );
      }
      const selected = {
        ...f.selected,
        provider: {
          ...f.selected.provider,
          generate,
          stream: undefined,
          capabilities: {
            ...f.selected.provider.capabilities,
            streaming: false,
            ...(grounded ? { toolCalling: true } : {}),
          },
        },
      };
      const local = localData(grounded ? [memoryRecord(1)] : []);
      const data = local.data;
      if (mode === 'grounded-denied' || mode === 'grounded-changed') {
        f.authorize.mockImplementation(async request => {
          const hasMemory = JSON.stringify(request.payload).includes(
            '기억 내용 1',
          );
          if (!hasMemory) return 'authorized';
          if (mode === 'grounded-denied') return 'renewal_required';
          local.replaceMemoryRecords([]);
          return 'authorized';
        });
      }
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
      if (mode === 'grounded-denied' || mode === 'grounded-changed') {
        expect(result).toMatchObject({
          status: 'failure',
          kind:
            mode === 'grounded-denied' ? 'consent_required' : 'stale_evidence',
        });
        expect(generate).toHaveBeenCalledTimes(3);
      } else if (grounded) {
        expect(result).toMatchObject({
          status: 'answer',
          completion: 'partial',
          citations: [
            expect.objectContaining({ sourceKind: 'reviewed_memory' }),
          ],
        });
        expect(generate).toHaveBeenCalledTimes(4);
      } else if (mode === 'unavailable') {
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
