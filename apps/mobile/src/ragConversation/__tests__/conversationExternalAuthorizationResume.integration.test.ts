import { runMigrations } from '@orot/storage';
import type {
  EvidenceSearchTool,
  EuropePmcAdapterPublication,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createExternalConversationEvidence } from '../../aiFeatures/integration/externalConversationEvidence';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationWorkflowContinuationStore } from '../../storage/conversationWorkflowContinuationStore';
import { runContinuableConversationWorkflow } from '../conversationWorkflowContinuation';
const { makeProvider, publication, scriptedOutputs, workflowOptions } =
  jest.requireActual<{
    publication: EuropePmcAdapterPublication;
    scriptedOutputs(): string[];
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

/** Real SQLite, LangGraph and app topic/lineage wrapper; synthetic model and literature service only. */
test('external query approval resumes prepared topics without rerunning the planner or dropping source lineage', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const requests = createConversationArtifactStorage(connection.database);
    await requests.createSession('session', await requests.currentGeneration());
    let pause = () => {};
    let approvals = 0;
    const queryConsent = {
      authorize: jest.fn(async () => {
        approvals += 1;
        if (approvals === 1) pause();
        return 'authorized' as const;
      }),
    };
    const service = {
      search: jest.fn(async (_query: string) => ({
        status: 'available' as const,
        publications: [publication],
      })),
    };
    const external = createExternalConversationEvidence(service, queryConsent);
    const outputs = scriptedOutputs();
    outputs[1] = JSON.stringify({
      toolId: external.tool.id,
      sourceKind: 'external_medical',
      input: { topics: ['sleep'] },
    });
    const { provider, generate } = makeProvider(outputs);
    const options = {
      ...workflowOptions(provider, external.tool),
      revalidateEvidence: async (
        refs: readonly Parameters<typeof external.validates>[0][],
      ) => refs.every(ref => external.validates(ref)),
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
      expect(generate).toHaveBeenCalledTimes(2);
      expect(service.search).not.toHaveBeenCalled();
      expect(await requests.listInterruptedRequests('session', 0)).toEqual([
        expect.objectContaining({ interruptionReason: 'decision-required' }),
      ]);
      return true;
    });
    const result = await runContinuableConversationWorkflow(
      options,
      {},
      {
        persisted,
        bindPause: fn => {
          pause = fn;
        },
        waitForContinue,
      },
    );
    expect(result.status).toBe('result');
    expect(waitForContinue).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(queryConsent.authorize).toHaveBeenCalledTimes(2);
    expect(service.search).toHaveBeenCalledTimes(1);
    expect(service.search.mock.calls[0][0]).toBe('sleep');
    if (result.status === 'result')
      expect(result.citations.every(external.validates)).toBe(true);
    expect(JSON.stringify(result.checkpoint)).not.toContain('"topics"');
    expect(JSON.stringify(result.checkpoint)).not.toContain('"query"');
  } finally {
    connection.close();
  }
});
