import {
  runMultiAgentWorkflow,
  DEFAULT_MULTI_AGENT_BUDGET,
} from '@orot/agent-runtime';
import type { EvidenceBatch, TaskResponderContract } from '@orot/agent-runtime';
import type {
  JsonValue,
  LanguageModelRequest,
  LanguageModelResponse,
} from '@orot/model-runtime';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { createChatGPTPlanProvider } from '@orot/provider-openai';
import { FakeNativeBridge } from '../../../../../../packages/provider-apple/__tests__/providerTestSupport';
import { FakeBridge } from '../../../../../../packages/provider-openai/__tests__/providerTestSupport';
import { ragConversationTask } from '../../../ragConversation/task';
import { serializeAppleRequest } from '../serializeRequest';

export const batch: EvidenceBatch = {
  items: [
    {
      sourceKind: 'personal_record',
      sourceId: 's1',
      sourceRevision: 'sr1',
      evidenceId: 'e1',
      evidenceRevision: 'er1',
      locator: { kind: 'local-evidence', token: 'e1' },
      effectiveTime: '2026-10-01T09:00:00Z',
      reviewState: 'unreviewed',
      content: '합성 기록: 아세트아미노펜 500mg을 어제 복용했다고 기록했어요.',
    },
  ],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['s1'],
      gaps: [],
      truncated: true,
      selectionMethod: 'ranked_retrieval',
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};
const supported: JsonValue = {
  type: 'result',
  value: { answer: '기록에는 아세트아미노펜 500mg을 복용했다고 적혀 있어요.' },
  citations: ['e1'],
};

// Both real adapters execute the real runtime/task; only the remote/native transport is synthetic.
function providerFor(
  kind: 'Apple' | 'ChatGPT',
  output: JsonValue,
  beforeReply?: () => void,
) {
  let calls = 0;
  if (kind === 'Apple') {
    const native = new FakeNativeBridge();
    native.generate = async (
      request: LanguageModelRequest,
    ): Promise<LanguageModelResponse> => {
      serializeAppleRequest(request);
      calls += 1;
      beforeReply?.();
      return {
        text: JSON.stringify(output),
        structuredOutput: output,
        toolCalls: [],
        finishReason: 'complete',
      };
    };
    return {
      provider: new AppleFoundationModelsProvider(native),
      calls: () => calls,
    };
  }
  const bridge = new FakeBridge(async (requestId, target) => {
    calls += 1;
    beforeReply?.();
    target.emit({
      requestId,
      type: 'text_delta',
      text: JSON.stringify(output),
    });
    target.emit({ requestId, type: 'completed', text: JSON.stringify(output) });
  });
  return {
    provider: createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'synthetic',
      model: { slug: 'synthetic-model', displayName: 'Synthetic' },
    }),
    calls: () => calls,
  };
}

export async function run(
  kind: 'Apple' | 'ChatGPT',
  evidence = batch,
  options: {
    output?: JsonValue;
    task?: TaskResponderContract<unknown>;
    current?: boolean;
    controller?: AbortController;
    beforeReply?: () => void;
  } = {},
) {
  const transport = providerFor(
    kind,
    options.output ?? supported,
    options.beforeReply,
  );
  const revalidate = jest.fn(async () => options.current !== false);
  const result = await runMultiAgentWorkflow(
    {
      request: '내가 먹는 약은?',
      provider: transport.provider,
      task: options.task ?? ragConversationTask,
      initialEvidence: evidence,
      tools: [],
      consent: { authorize: async () => 'authorized' as const },
      revalidateEvidence: revalidate,
      execution: {
        operationRunId: `ranked-${kind}`,
        providerId: transport.provider.id,
        modelId: kind === 'Apple' ? 'system-default' : 'synthetic-model',
        recipient: kind,
        remoteProcessing: kind === 'ChatGPT',
        allowedScope: { sourceKinds: ['personal_record'] },
        budget: DEFAULT_MULTI_AGENT_BUDGET,
      },
    },
    { signal: options.controller?.signal },
  );
  return { result, revalidate, calls: transport.calls() };
}
