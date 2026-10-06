import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelResponse,
  type LanguageModelStreamEvent,
  type ProviderResult,
} from '@orot/model-runtime';
import { runMultiAgentWorkflow, type EvidenceBatch, type MultiAgentWorkflowOptions } from '../src';

const noEvidence: EvidenceBatch = { items: [], coverage: [], conflicts: [] };

function cancellationOptions(
  provider: LanguageModelProvider,
): MultiAgentWorkflowOptions<{ summary: string }> {
  return {
    execution: {
      operationRunId: 'run-cancel-1',
      providerId: provider.id,
      modelId: 'model-cancel-1',
      recipient: 'selected-account',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: ['record-1'] },
      budget: {
        maxModelCalls: 3,
        maxToolCalls: 1,
        maxResearchCycles: 1,
        maxPayloadBytes: 32000,
        maxOutputTokens: 512,
        timeoutMs: 5000,
        maxEvidenceItems: 5,
      },
    },
    provider,
    request: 'Prepare synthetic visit questions.',
    task: {
      taskType: 'synthetic-visit-questions',
      taskVersion: '1',
      systemPrompt: 'Return a cautious, evidence-linked result.',
      resultSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
      createMessages: ({ request, evidence }) => [
        {
          role: 'user',
          content: `${request}\n${evidence.items.map((item) => item.content).join('\n')}`,
        },
      ],
      validateResult(value) {
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          typeof value.summary !== 'string'
        ) {
          return { status: 'invalid', reason: 'A summary is required.' };
        }
        return { status: 'valid', value: { summary: value.summary } };
      },
    },
    initialEvidence: noEvidence,
    tools: [
      {
        id: 'local-record-search',
        sourceKind: 'personal_record',
        execution: 'local_read_only',
        description: 'Search selected local records for a bounded evidence need.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        parseInput(value: unknown) {
          return value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.keys(value).length === 0
            ? {}
            : undefined;
        },
        async search() {
          return noEvidence;
        },
      },
    ],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

describe('multi-agent cancellation boundaries', () => {
  it('stops downstream dispatch when a non-streaming provider call cannot be confirmed cancelled', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const generate = jest.fn(() => {
      markStarted();
      return new Promise<ProviderResult<LanguageModelResponse>>(() => undefined);
    });
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'selected-model',
      displayName: 'Selected model',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate,
    };
    const options = cancellationOptions(provider);
    const search = jest.spyOn(options.tools[0]!, 'search');
    const controller = new AbortController();
    const pending = runMultiAgentWorkflow(options, { signal: controller.signal });

    await started;
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({
      status: 'cancelled',
      providerStop: 'underlying_call_unconfirmed',
      downstreamDispatchStopped: true,
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('records an iterator-return request without claiming provider cancellation', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'selected-model',
      displayName: 'Selected model',
      capabilities: {
        inputTypes: ['text'],
        streaming: true,
        structuredOutput: false,
        toolCalling: false,
      },
      async generate() {
        return providerSuccess({ text: '{}', toolCalls: [], finishReason: 'complete' });
      },
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => {
            markStarted();
            return new Promise<IteratorResult<ProviderResult<LanguageModelStreamEvent>>>(
              () => undefined,
            );
          },
          return: jest.fn(async () => ({ done: true as const, value: undefined })),
        }),
      }),
    };
    const options = cancellationOptions(provider);
    const search = jest.spyOn(options.tools[0]!, 'search');
    const controller = new AbortController();
    const pending = runMultiAgentWorkflow(options, { signal: controller.signal });

    await started;
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({
      status: 'cancelled',
      providerStop: 'iterator_return_requested',
      downstreamDispatchStopped: true,
    });
    expect(search).not.toHaveBeenCalled();
  });
});
