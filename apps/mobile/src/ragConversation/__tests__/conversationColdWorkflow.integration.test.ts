import { runMigrations } from '@orot/storage';
import {
  createMultiAgentPauseController,
  type EvidenceSearchTool,
  type MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { JsonObject, LanguageModelProvider } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationWorkflowContinuationStore } from '../../storage/conversationWorkflowContinuationStore';
import { createConversationColdResumeStorage } from '../../storage/conversationColdResumeStorage';
import { saveConversationColdBoundary } from '../../storage/saveConversationColdBoundary';
import { createExternalConversationEvidence } from '../../aiFeatures/integration/externalConversationEvidence';
import { runContinuableConversationWorkflow } from '../conversationWorkflowContinuation';
import { runColdConversationWorkflow } from '../runColdConversationWorkflow';
import { ragConversationTask } from '../task';
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

const identity = {
  requestId: 'request',
  sessionId: 'session',
  sessionVersion: 0,
};
function adapters(pauseSearch = () => {}, pauseModel = () => {}) {
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: [],
  }));
  const queryConsent = {
    authorize: jest.fn(async () => {
      pauseSearch();
      return 'authorized' as const;
    }),
  };
  const external = createExternalConversationEvidence({ search }, queryConsent);
  const { provider, generate } = makeProvider([
    JSON.stringify({
      type: 'result',
      value: { answerKind: 'conversation', answer: '어떤 점이 궁금하신가요?' },
      citations: [],
    }),
  ]);
  const options = {
    ...workflowOptions(provider, external.tool),
    task: ragConversationTask,
    request: '수면 이야기를 나누고 싶어요.',
    initialSearch: { toolId: external.tool.id, input: { topics: ['sleep'] } },
    consent: {
      authorize: jest.fn(async () => {
        pauseModel();
        return 'authorized' as const;
      }),
    },
  };
  return { options, search, queryConsent, generate };
}

/** Fresh stores, providers and search adapters at each stage; real SQLite and LangGraph, no network. */
test.each([false, true])(
  'cold search/model approval preserves ownership (corrupt checkpoint: %s)',
  async malformed => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const requests = createConversationArtifactStorage(connection.database);
      await requests.createSession(
        'session',
        await requests.currentGeneration(),
      );
      let pause = () => {};
      const first = adapters(() => pause());
      await requests.startRequest({
        ...identity,
        id: 'request',
        question: first.options.request,
        createdAt: '2026-11-14T00:00:00.000Z',
      });
      const persisted: Awaited<
        ReturnType<typeof createConversationWorkflowContinuationStore>
      > = await createConversationWorkflowContinuationStore(
        connection.database,
        identity,
        saveConversationColdBoundary(
          connection.database,
          identity,
          async () => {
            if (malformed) {
              const config = {
                configurable: { thread_id: persisted.threadId },
              };
              const tuple = (await persisted.checkpointer.getTuple(config))!;
              await persisted.checkpointer.put(
                config,
                {
                  ...tuple.checkpoint,
                  channel_values: {
                    ...tuple.checkpoint.channel_values,
                    modelCalls: -1,
                  },
                },
                tuple.metadata!,
                {},
              );
            }
            return {
              evidenceBatches: [
                first.options.initialEvidence,
              ] as unknown as JsonObject['evidenceBatches'],
            };
          },
        ),
      );
      const initial = await runContinuableConversationWorkflow(
        first.options,
        {},
        {
          persisted,
          bindPause: fn => {
            pause = fn;
          },
          waitForContinue: async () => false,
        },
      );
      expect(initial.status).toBe('paused');
      expect(first.search).not.toHaveBeenCalled();
      expect(first.generate).not.toHaveBeenCalled();
      const secondPause = createMultiAgentPauseController();
      const second = adapters(undefined, () => secondPause.requestPause());
      const cold = createConversationColdResumeStorage(connection.database);
      const saved = await cold.open(identity);
      expect(saved).toBeDefined();
      if (malformed) {
        await expect(
          runColdConversationWorkflow({
            database: connection.database,
            descriptor: saved!,
            options: second.options,
            invocation: {},
            validateSelection: async () => {},
            capture: async () => ({}),
          }),
        ).rejects.toThrow('current runtime');
        expect(
          (
            await connection.database.execute(
              'SELECT attempt, claimed FROM conversation_workflow_resumes',
            )
          ).rows,
        ).toEqual([{ attempt: 0, claimed: 0 }]);
        expect(second.search).not.toHaveBeenCalled();
        expect(second.queryConsent.authorize).not.toHaveBeenCalled();
        expect(second.generate).not.toHaveBeenCalled();
        return;
      }

      const resumed = await runColdConversationWorkflow({
        database: connection.database,
        descriptor: saved!,
        options: second.options,
        invocation: { pause: secondPause },
        validateSelection: async () => {},
        capture: async () => ({}),
      });
      expect(resumed).toMatchObject({
        status: 'paused',
        checkpoint: { initialSearchStatus: 'empty' },
      });
      expect(second.search).toHaveBeenCalledTimes(1);
      expect(second.queryConsent.authorize).toHaveBeenCalledTimes(1);
      expect(second.generate).not.toHaveBeenCalled();
      const third = adapters();
      const savedAgain = await createConversationColdResumeStorage(
        connection.database,
      ).open(identity);
      expect(savedAgain?.attempt).toBe(1);
      const result = await runColdConversationWorkflow({
        database: connection.database,
        descriptor: savedAgain!,
        options: third.options,
        invocation: {},
        validateSelection: async () => {},
        capture: async () => ({}),
      });
      expect(result.status).toBe('result');
      expect(third.search).not.toHaveBeenCalled();
      expect(third.queryConsent.authorize).not.toHaveBeenCalled();
      expect(third.options.consent.authorize).toHaveBeenCalledTimes(1);
      expect(third.generate).toHaveBeenCalledTimes(1);
      expect(
        (
          await connection.database.execute(
            'SELECT id FROM conversation_requests',
          )
        ).rows,
      ).toEqual([{ id: 'request' }]);
      expect(JSON.stringify(third.generate.mock.calls)).toContain('europe-pmc');
    } finally {
      connection.close();
    }
  },
);
