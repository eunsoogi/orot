import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { conversationMutationExecution } from '../../aiFeatures/integration/conversationMutationExecution';
import {
  apple,
  localData,
} from '../../aiFeatures/integration/featureServiceFixtures';
import { executionOptions } from '../../aiFeatures/integration/featureServiceExecution';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { GroundedRagAnswer } from '../../ragConversation/task';

/** Replaces the manual action simulation with the real shared model/action loop. */
export async function runDailyReportBookmarkGraphFixture(
  observer: RagConversationObserver,
  confirmHistorySave: NonNullable<
    RagConversationObserver['confirmHistorySave']
  >,
  signal: AbortSignal,
) {
  const target = { target: 'preceding_daily_report' };
  const toolId = 'remember-daily-report';
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    expect(request.tools?.some(tool => tool.name === toolId)).toBe(true);
    expect(JSON.stringify(request)).not.toContain(
      observer.reportBookmark?.artifactId,
    );
    return providerSuccess({
      text: 'Untrusted proposal prose.',
      finishReason: 'tool_calls' as const,
      toolCalls: [{ id: 'proposal', name: toolId, arguments: target }],
    });
  });
  const provider = {
    ...apple.provider,
    generate,
    capabilities: {
      ...apple.provider.capabilities,
      streaming: false,
      toolCalling: true,
    },
  };
  const selected = {
    status: 'ready' as const,
    selection: { providerId: provider.id, modelId: apple.modelId },
    provider,
    option: apple,
    modelId: apple.modelId,
    remoteProcessing: false,
    recipient: 'Synthetic device',
  };
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const registry = new LocalEvidenceReferenceRegistry();
  const question = 'Could you keep that daily report for later?';
  const mutation = conversationMutationExecution({
    baseExecution: executionOptions({
      consentPurpose: 'record_conversation',
      selected,
      operationRunId: 'synthetic-daily-semantic',
      registry,
      consent,
      tools: [],
    }),
    selected,
    observer: { ...observer, confirmHistorySave },
    registry,
    question,
    photo: undefined,
    photoEvidence: undefined,
    data: localData([]).data,
    history: {
      messages: [],
      reports: [],
      references: [],
      sources: [],
      priorTurns: [],
      omitted: false,
      excludedQuestions: [],
    },
  });
  const action =
    'actions' in mutation.execution
      ? mutation.execution.actions.find(item => item.id === toolId)
      : undefined;
  expect(
    action?.parseInput({ target: 'preceding_health_summary' }),
  ).toBeUndefined();
  expect(
    action?.parseInput({ ...target, artifactId: 'model-selected' }),
  ).toBeUndefined();
  const result = await runMultiAgentWorkflow<GroundedRagAnswer>(
    {
      ...mutation.execution,
      request: question,
      task: {
        taskType: 'synthetic-daily-bookmark-terminal',
        taskVersion: '1',
        systemPrompt: 'Call the supplied tool only as requested.',
        resultSchema: { type: 'object' },
        createMessages: ({ request }) => [{ role: 'user', content: request }],
        validateResult: () => ({
          status: 'invalid',
          reason: 'Host receipt only.',
        }),
      },
      initialEvidence: { items: [], coverage: [], conflicts: [] },
    },
    { signal },
  ).finally(mutation.disposeAnswerMemory);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(mutation.memorySaved()).toBe('generated-report');
  expect(result).toMatchObject({
    status: 'result',
    value: { answer: '보고서 링크를 기억에 보관했어요.' },
    checkpoint: { terminal: true, committedAction: true },
  });
}
