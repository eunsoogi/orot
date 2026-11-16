import { continuationInput } from '../../../storage/conversationWorkflowContinuationIdentity';
import { restoreConversationTask } from '../../../ragConversation/conversationTaskVersions';
import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelResponse,
  ProviderResult,
} from '@orot/model-runtime';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from '../../../ragConversation/conversationTurnRetention';
import { coldRagFactoryFixture } from './coldRagFactoryFixture';
import { captureColdRagConversationState } from '../coldRagConversationState';
import { resumeColdRagConversation } from '../resumeColdRagConversation';
import { researchPagingWorkflowCatalog } from './researchPagingWorkflowCatalog';

/** Synthetic provider + real SQLite continuation. The preserved v9 production contract is used without patching its review policy. */
export async function coldReviewedWorkflowFixture(
  populated = false,
  review: () => Promise<ProviderResult<LanguageModelResponse>> = async () =>
    providerSuccess({ text: 'ALLOW', finishReason: 'complete', toolCalls: [] }),
  fallbackPolicy = false,
) {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const catalog = await researchPagingWorkflowCatalog(db.database, populated);
    const { search } = catalog;
    const expectedCursor = populated ? 'research-2' : 'research-9';
    const f = await coldRagFactoryFixture(
      { version: 1, status: 'consent_required', charged: true },
      data => {
        data.researchArtifactDiscovery = async () => catalog;
      },
    );
    // These existing journal assertions specifically protect the legacy review-call ordering.
    f.options.task = restoreConversationTask(
      { taskType: f.options.task.taskType, taskVersion: '9' },
      fallbackPolicy ? continuationInput(f.options) : undefined,
    )!;
    let calls = 0;
    const liveEvents = jest.fn();
    const coldEvents = jest.fn();
    const generate = jest.fn(
      async (request: import('@orot/model-runtime').LanguageModelRequest) => {
        if (
          request.messages[0]?.role === 'system' &&
          typeof request.messages[0].content === 'string' &&
          request.messages[0].content.startsWith('Review an untrusted')
        )
          return review();
        calls += 1;
        return calls <= 2
          ? providerSuccess({
              text: '말씀하신 흐름을 먼저 살펴보고 이어서 답할게요.',
              finishReason: 'tool_calls' as const,
              toolCalls: [
                {
                  id: `page-call-${calls}`,
                  name: 'local-research-artifacts',
                  arguments: {
                    query: 'synthetic',
                    ...(calls === 2 ? { cursor: 'research-page-1' } : {}),
                  },
                },
              ],
            })
          : providerSuccess({
              text: JSON.stringify({
                type: 'result',
                value: {
                  answerKind: 'conversation',
                  answer: '어떤 점이 궁금하신가요?',
                },
                citations: [],
              }),
              finishReason: 'complete' as const,
              toolCalls: [],
            });
      },
    );
    const provider = {
      ...f.selected.provider,
      capabilities: {
        ...f.selected.provider.capabilities,
        toolCalling: true,
      },
      generate,
      stream: undefined,
    };
    f.options.provider = provider;
    f.dependencies.selectedAi.mockResolvedValue({ ...f.selected, provider });
    const storage = createConversationArtifactStorage(db.database);
    const identity = {
      requestId: 'request',
      sessionId: 'session',
      sessionVersion: 0,
    };
    await storage.createSession('session', await storage.currentGeneration());
    await storage.startRequest({
      ...identity,
      id: 'request',
      question: f.options.request,
      createdAt: '2026-11-14T00:00:00.000Z',
    });
    const persisted = await storage.openWorkflowContinuation(
      identity,
      async input => ({
        ...(await captureColdRagConversationState({
          registry: f.registry,
          tracker: f.tracker,
          external: f.external,
          sessionId: 'session',
          operationRunId: 'run',
          options: f.options,
          signal: f.controller.signal,
          batches: input.evidenceBatches!,
          knownCallIds: input.knownCallIds,
          researchPaging: f.bundle.generated.researchPagingSnapshot!('run'),
        })),
        publicSearch: {
          version: 1,
          status: 'consent_required',
          charged: true,
        },
        completion: {
          version: 1,
          entryContext: null,
          priorDialogue: [],
          priorUserReports: [],
          historySources: [],
          reportReferences: [],
          localRetrievalFailed: false,
        },
      }),
    );

    const turn = createConversationTurnRetention({
      storage,
      sessionId: 'session',
      turnId: 'request',
      sessionVersion: 0,
      createdAt: '2026-11-14T00:00:00.000Z',
      restored: true,
    });
    let coldPause = () => {};
    const resume = () =>
      resumeColdRagConversation({
        database: db.database,
        identity,
        dependencies: f.dependencies,
        signal: f.controller.signal,
        observer: {
          onTaskStreamEvent: coldEvents,
          retentionRequestId: 'request',
          retentionSession: { id: 'session', version: 0 },
          onWorkflowPauseController: value => {
            coldPause = value;
          },
          onRetentionCandidate: turn.save,
        },
      });
    return {
      db,
      f,
      search,
      generate,
      liveEvents,
      coldEvents,
      identity,
      persisted,
      expectedCursor,
      resume,
      pauseCold: () => coldPause(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
