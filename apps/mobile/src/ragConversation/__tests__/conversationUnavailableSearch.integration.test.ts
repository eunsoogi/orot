import { finishRagConversation } from '../../aiFeatures/integration/finishRagConversation';
import { ragConversationTask } from '../task';
import { runMigrations } from '@orot/storage';
import type {
  EvidenceSearchTool,
  EvidenceItem,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createPublicWebEvidence } from '../../aiFeatures/integration/publicWebEvidence';
import { publicEvidenceFixture } from '../../aiFeatures/integration/testSupport/publicWebEvidenceTestSupport';
import { publicSearchNotice } from '../../aiFeatures/integration/defaultPublicSearch';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationWorkflowContinuationStore } from '../../storage/conversationWorkflowContinuationStore';
import { runContinuableConversationWorkflow } from '../conversationWorkflowContinuation';
const { makeProvider, workflowOptions } = jest.requireActual<{
  makeProvider(outputs: string[]): {
    provider: LanguageModelProvider;
    generate: jest.Mock;
  };
  workflowOptions(
    provider: LanguageModelProvider,
    tool: EvidenceSearchTool,
  ): MultiAgentWorkflowOptions<unknown>;
}>(
  '../../../../../packages/agent-runtime/__tests__/multiAgent-external-evidence-fixtures',
);

/** Real SQLite and graph; synthetic public search fails before an authorized local-only response. */
test.each([
  { grounded: false, code: 'provider_unavailable', ranked: false },
  { grounded: true, code: 'provider_unavailable', ranked: false },
  { grounded: true, code: 'internal_error', ranked: true },
  { grounded: true, code: 'rate_limited', ranked: true },
  { grounded: true, code: 'unsupported_capability', ranked: false },
] as const)(
  'failed research preserves local fallback across pause: $code / ranked=$ranked',
  async ({ grounded, code, ranked }) => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const requests = createConversationArtifactStorage(connection.database);
      await requests.createSession(
        'session',
        await requests.currentGeneration(),
      );
      let pause = () => {};
      let modelApprovals = 0;
      const fixture = publicEvidenceFixture();
      fixture.search.mockResolvedValue({
        ok: false,
        error: {
          code,
          message: 'synthetic',
          retryable: true,
        },
      });
      const external = createPublicWebEvidence({
        ...fixture,
        recoverUnavailable: true,
      })!;
      const events: { status: string }[] = [];
      const local: EvidenceItem = {
        sourceKind: 'personal_record',
        sourceId: 'synthetic-record',
        sourceRevision: '1',
        evidenceId: 'local-1',
        evidenceRevision: '1',
        locator: { kind: 'synthetic' },
        effectiveTime: null,
        reviewState: 'reviewed',
        content: '수면 시간이 7 hours로 기록되어 있어요.',
      };
      const { provider, generate } = makeProvider([
        JSON.stringify({
          type: 'result',
          value: {
            answerKind: grounded ? 'grounded' : 'conversation',
            completion: 'partial',
            answer: grounded
              ? '수면 시간이 7 hours로 기록되어 있어요.'
              : '어떤 점이 궁금하신가요?',
          },
          citations: grounded ? [local.evidenceId] : [],
        }),
      ]);
      const options = {
        ...workflowOptions(provider, external.tool),
        execution: {
          ...workflowOptions(provider, external.tool).execution,
          allowedScope: {
            sourceKinds: ['personal_record', 'external_medical'] as const,
          },
        },
        initialEvidence: grounded
          ? {
              items: [local],
              conflicts: [],
              coverage: [
                {
                  sourceKind: 'personal_record' as const,
                  searchedSourceIds: [local.sourceId],
                  gaps: [],
                  truncated: ranked,
                  ...(ranked
                    ? { selectionMethod: 'ranked_retrieval' as const }
                    : {}),
                  resultLimit: 1,
                  returnedCount: 1,
                },
              ],
            }
          : { items: [], coverage: [], conflicts: [] },
        task: ragConversationTask,
        request: grounded
          ? '기록된 수면 시간은 얼마인가요?'
          : '수면 이야기를 나누고 싶어요.',
        initialSearch: {
          toolId: external.tool.id,
          input: { topics: ['sleep'] },
        },
        consent: {
          authorize: async () => {
            if (++modelApprovals === 1) pause();
            return 'authorized' as const;
          },
        },
      };
      await requests.startRequest({
        id: 'request',
        sessionId: 'session',
        sessionVersion: 0,
        question: options.request,
        createdAt: '2026-11-14T00:00:00.000Z',
      });
      const persisted = await createConversationWorkflowContinuationStore(
        connection.database,
        { requestId: 'request', sessionId: 'session', sessionVersion: 0 },
      );
      const waitForContinue = jest.fn(async () => {
        expect(generate).not.toHaveBeenCalled();
        expect(fixture.search).toHaveBeenCalledTimes(1);
        return true;
      });
      const result = await runContinuableConversationWorkflow(
        options,
        { onToolEvent: event => events.push(event) },
        {
          persisted,
          bindPause: fn => {
            pause = fn;
          },
          waitForContinue,
        },
      );
      expect(result).toMatchObject({
        status: 'result',
        checkpoint: { initialSearchStatus: 'unavailable' },
      });
      if (grounded && result.status === 'result') {
        expect(result.value).toMatchObject({
          answerKind: 'grounded',
          completion: 'partial',
          answer: local.content,
        });
        expect(result.citations).toEqual([
          expect.objectContaining({
            evidenceId: local.evidenceId,
            sourceId: local.sourceId,
          }),
        ]);
      }
      expect(waitForContinue).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(fixture.search).toHaveBeenCalledTimes(1);
      expect(fixture.authorize).toHaveBeenCalledTimes(1);
      expect(modelApprovals).toBe(2);
      const payload = JSON.stringify(generate.mock.calls[0]);
      expect(payload).toContain('returnedCount');
      expect(payload).toContain('searchedSourceIds');
      expect(payload).toContain('public-web');
      expect(payload).toContain('Public web search was unavailable');
      expect(result.checkpoint.modelCalls).toBe(2);
      expect(result.checkpoint.toolCalls).toBe(1);
      expect(events.map(event => event.status)).toEqual(['started', 'failed']);
      expect(generate.mock.calls[0][0].tools ?? []).toEqual([]);
      expect(publicSearchNotice('unavailable')).not.toBe(
        publicSearchNotice('empty'),
      );
      if (result.status !== 'result')
        throw new Error(
          'The synthetic local fallback did not produce a result.',
        );
      const finish = jest.fn(async outcome => ({ retained: true, outcome }));
      const final = await finishRagConversation({
        outcome: {
          status: 'answer',
          answer: local.content,
          completion: 'partial',
          citations: result.citations,
        },
        publicSearch: { status: 'unavailable' },
        retention: { finish } as unknown as Parameters<
          typeof finishRagConversation
        >[0]['retention'],
        signal: new AbortController().signal,
        continuation: false,
      });
      expect(final).toMatchObject({
        answer: `${local.content}\n\n${publicSearchNotice('unavailable')}`,
      });
      expect(finish).toHaveBeenCalledWith(final);
    } finally {
      connection.close();
    }
  },
);
