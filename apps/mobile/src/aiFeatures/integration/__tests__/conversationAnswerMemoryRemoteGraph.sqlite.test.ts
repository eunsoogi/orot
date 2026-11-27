import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import type { GroundedRagAnswer } from '../../../ragConversation/task';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';
import { createConversationSummaryIntegration } from '../conversationSummaryIntegration';
import { conversationMutationExecution } from '../conversationMutationExecution';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { executionOptions } from '../featureServiceExecution';
import type { SelectedAiResolution } from '../provider';
import type { AiFeatureLocalData } from '../localData';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';

const providerId = 'chatgpt-plan:synthetic';
const modelId = 'synthetic-model';
const sessionId = 'private-test-session';
const sourceId = 'private-test-artifact';
const currentId = 'private-test-request';
const originalAnswer =
  'Private synthetic answer only for the local approval sheet.';
const currentQuestion = 'Remember the previous answer.';
const target = { target: 'previous_completed_answer' };
const toolId = 'remember-conversation-answer';
const preflight = { items: [], coverage: [], conflicts: [] };
test('existing remote conversation offers only an opaque target and ends with a local receipt', async () => {
  const box = await healthContextFixture();
  try {
    const signal = new AbortController().signal;
    const storage = createConversationArtifactStorage(box.database);
    await storage.createSession(sessionId, await storage.currentGeneration());
    const prior = {
      id: sourceId,
      sessionId,
      sessionVersion: 0,
      createdAt: '2026-11-25T00:00:00.000Z',
      question: 'Synthetic preceding question.',
    };
    await storage.startRequest(prior);
    await storage.append({
      ...prior,
      providerId,
      modelId,
      answer: originalAnswer,
      status: 'complete',
      sources: box.saved.sources,
    });
    await storage.startRequest({
      ...prior,
      id: currentId,
      question: currentQuestion,
      createdAt: '2026-11-25T00:00:01.000Z',
    });
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      expect(
        request.tools?.find(tool => tool.name === toolId)?.inputSchema,
      ).toEqual({
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['previous_completed_answer'] },
        },
        required: ['target'],
        additionalProperties: false,
      });
      for (const unavailable of [
        originalAnswer,
        sourceId,
        sessionId,
        currentId,
      ])
        expect(JSON.stringify(request)).not.toContain(unavailable);
      return providerSuccess({
        text: 'Untrusted faux receipt.',
        finishReason: 'tool_calls' as const,
        toolCalls: [{ id: 'proposal', name: toolId, arguments: target }],
      });
    });
    const provider: LanguageModelProvider = {
      id: providerId,
      kind: 'language-model',
      displayName: 'Synthetic selected provider',
      capabilities: {
        streaming: false,
        toolCalling: true,
        structuredOutput: false,
        inputTypes: ['text'],
      },
      generate,
    };
    const selection = {
      status: 'ready',
      selection: { providerId, modelId },
      provider,
      modelId,
      recipient: 'synthetic-selected-recipient',
      remoteProcessing: true,
    } as Extract<SelectedAiResolution, { status: 'ready' }>;
    const consent = { authorize: jest.fn(async () => 'authorized' as const) };
    const registry = new LocalEvidenceReferenceRegistry();
    const data = {
      openConversationArtifactStorage: async () => storage,
    } as AiFeatureLocalData;
    const unwatch = jest.fn();
    const confirm = jest.fn(async () => true);
    const observer = {
      inputOrigin: 'composer',
      expectedConversationModel: { providerId, modelId },
      retentionSession: { id: sessionId, version: 0 },
      retentionRequestId: currentId,
      retainedHistory: [{ id: sourceId, question: prior.question }],
      confirmHistorySave: confirm,
      templateProposalOwner: {
        providerId,
        modelId,
        current: () => true,
        recheck: jest.fn(async () => true),
        watch: () => unwatch,
      },
    } satisfies RagConversationObserver;
    const baseExecution = executionOptions({
      consentPurpose: 'record_conversation',
      selected: selection,
      operationRunId: 'remote-selected-answer-test',
      registry,
      consent,
      tools: [],
    });
    const compose = (
      remoteMemory: Parameters<
        typeof conversationMutationExecution
      >[0]['remoteMemory'],
    ) =>
      conversationMutationExecution({
        baseExecution,
        selected: selection,
        registry,
        data,
        observer,
        photo: undefined,
        photoEvidence: undefined,
        question: currentQuestion,
        remoteMemory,
        history: {
          messages: [],
          reports: [],
          references: [],
          sources: [],
          priorTurns: [],
          historicalDialogueParents: [
            { id: sourceId, createdAt: prior.createdAt },
          ],
          omitted: false,
          excludedQuestions: [],
        },
      });
    const actions = (execution: ReturnType<typeof compose>['execution']) =>
      'actions' in execution ? execution.actions : [];
    expect(
      actions(compose(false).execution).some(action => action.id === toolId),
    ).toBe(false);
    expect(
      actions(
        compose({
          intent: 'conversation',
          entryKey: 'typed',
          appointmentId: 'other',
        }).execution,
      ).some(action => action.id === toolId),
    ).toBe(false);
    const mutation = compose({
      intent: 'conversation',
      entryKey: 'mounted-conversation',
    });
    const action = actions(mutation.execution).find(
      offered => offered.id === toolId,
    );
    expect(
      action?.parseInput({ ...target, templateProposalOwner: {} }),
    ).toBeUndefined();
    expect(
      action?.parseInput({ ...target, artifactId: sourceId }),
    ).toBeUndefined();
    const opening = jest.fn(() => 'No speculative receipt.');
    const result = await runMultiAgentWorkflow<GroundedRagAnswer>(
      {
        ...mutation.execution,
        request: currentQuestion,
        task: {
          taskType: 'synthetic-selected-answer-terminal',
          taskVersion: '1',
          systemPrompt: 'Use only the supplied tool.',
          resultSchema: { type: 'object' },
          createMessages: ({ request }) => [{ role: 'user', content: request }],
          validateResult: () => ({
            status: 'invalid',
            reason: 'Host receipt only.',
          }),
          initialToolResponse: opening,
          reviewInitialToolResponse: true,
        },
        initialEvidence: preflight,
      },
      { signal },
    ).finally(mutation.disposeAnswerMemory);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(consent.authorize).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(originalAnswer, expect.anything());
    expect(opening).not.toHaveBeenCalled();
    expect(unwatch).toHaveBeenCalledTimes(1);
    expect(mutation.memorySaved()).toBe('saved');
    expect(result).toMatchObject({
      status: 'result',
      value: { answer: '이 기기의 기억에 저장했어요.' },
      checkpoint: { terminal: true, committedAction: true },
    });
    expect(await storage.listSavedConversationAnswers()).toHaveLength(1);
    const sendRagMessage = jest.fn();
    const selectedAi = jest.fn(async () => selection);
    const route = createConversationSummaryIntegration({
      consent,
      dependencies: {},
      loadData: async () => data,
      registry,
      selectedAi,
      diseaseRunner: jest.fn(),
      sendRagMessage,
      loadSavedVisitQuestions: jest.fn(),
    });
    const protectedReply = await route.sendRagMessage(
      '그래 그럼 기억해줘',
      [],
      signal,
      observer,
    );
    expect(protectedReply).toEqual({
      status: 'failure',
      kind: 'protected_memory_not_saved',
      discardUnverifiedDraft: true,
    });
    expect(sendRagMessage).not.toHaveBeenCalled();
    expect(selectedAi).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  } finally {
    box.close();
  }
});
