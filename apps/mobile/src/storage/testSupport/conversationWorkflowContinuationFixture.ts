import { runMigrations } from '@orot/storage';
import type {
  MultiAgentCheckpointState,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createConversationWorkflowContinuationStore } from '../conversationWorkflowContinuationStore';

export async function conversationWorkflowContinuationFixture() {
  const connection = openSqliteTestDatabase(':memory:');
  await runMigrations(connection.database);
  const requests = createConversationArtifactStorage(connection.database);
  await requests.createSession('session', await requests.currentGeneration());
  await requests.startRequest({
    id: 'request',
    sessionId: 'session',
    sessionVersion: 0,
    question: 'Synthetic question',
    createdAt: '2026-11-14T00:00:00.000Z',
  });
  const persisted = await createConversationWorkflowContinuationStore(
    connection.database,
    { requestId: 'request', sessionId: 'session', sessionVersion: 0 },
  );
  const execution = {
    operationRunId: 'run',
    providerId: 'p',
    modelId: 'm',
    recipient: 'p',
    remoteProcessing: false,
    allowedScope: { sourceKinds: ['personal_record'] },
    budget: {
      maxModelCalls: 3,
      maxToolCalls: 2,
      maxResearchCycles: 1,
      maxEvidenceItems: 5,
      maxPayloadBytes: 1000,
      maxOutputTokens: 100,
      timeoutMs: 10000,
    },
  };
  const validate = jest.fn(async () => true);
  // Synthetic adapter fixture does not execute a provider, authorize data, or validate graph semantics.
  const options = {
    execution,
    request: 'Synthetic question',
    context: { history: [] },
    task: { taskType: 'test' },
    tools: [],
    revalidateEvidence: validate,
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  await persisted.initialize(options, new AbortController().signal);
  const state = {
    ...execution,
    phase: 'task_response',
    modelCalls: 0,
    toolCalls: 0,
    researchCycles: 0,
    evidenceReferences: [{ sourceId: 'synthetic-source', revision: '1' }],
    terminal: false,
  } as unknown as MultiAgentCheckpointState;
  const checkpoint = {
    v: 4,
    ts: '2026-11-14T00:00:00.000Z',
    channel_versions: {},
    versions_seen: {},
    id: '0001',
    channel_values: { ...state },
  };
  const config = { configurable: { thread_id: persisted.threadId } };
  await persisted.checkpointer.put(
    config,
    checkpoint,
    { source: 'loop', step: 0, parents: {} },
    {},
  );
  return {
    connection,
    requests,
    persisted,
    state,
    checkpoint,
    config,
    options,
    validate,
  };
}

