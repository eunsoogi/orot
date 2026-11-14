import { runMigrations } from '@orot/storage';
import { createEuropePmcEvidenceSearchTool } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import type {
  MultiAgentWorkflowOptions,
  EvidenceSearchTool,
  EuropePmcAdapterPublication,
} from '@orot/agent-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
// Reuse runtime fixtures at execution time without changing that package's compiler configuration.
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
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationWorkflowContinuationStore } from '../../storage/conversationWorkflowContinuationStore';
import { runContinuableConversationWorkflow } from '../conversationWorkflowContinuation';

/** Actual protected-schema adapter and LangGraph checkpoints; all model/tool data is synthetic. */
test('explicit continue uses the same persisted graph and invokes a completed tool once', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const requests = createConversationArtifactStorage(connection.database);
    await requests.createSession('session', await requests.currentGeneration());
    let pause = () => {};
    const service = {
      search: jest.fn(async () => ({
        status: 'available' as const,
        publications: [publication],
      })),
    };
    const tool = createEuropePmcEvidenceSearchTool({
      service,
      consent: { authorize: async () => 'authorized' },
    });
    const search = jest.fn(async (...args: Parameters<typeof tool.search>) => {
      const result = await tool.search(...args);
      pause();
      return result;
    });
    const { provider, generate } = makeProvider(scriptedOutputs());
    const options = workflowOptions(provider, { ...tool, search });
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
      const row = await connection.database.execute(
        "SELECT status FROM conversation_requests WHERE id = 'request'",
      );
      expect(row.rows[0]?.status).toBe('interrupted');
      expect(search).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledTimes(2);
      return true;
    });
    const result = await runContinuableConversationWorkflow(
      options,
      {},
      {
        persisted,
        bindPause: request => {
          pause = request;
        },
        waitForContinue,
      },
    );
    expect(result.status).toBe('result');
    expect(waitForContinue).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(service.search).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(3);
    const row = await connection.database.execute(
      "SELECT status FROM conversation_requests WHERE id = 'request'",
    );
    expect(row.rows[0]?.status).toBe('active');
  } finally {
    connection.close();
  }
});
