import {
  providerFailure,
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceItem,
  type MultiAgentWorkflowOptions,
  type TaskResponderContract,
} from '../src';

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record-1',
  sourceRevision: 'record-rev-2',
  evidenceId: 'observation-1',
  evidenceRevision: 'evidence-rev-2',
  locator: { kind: 'structured_record', recordId: 'observation-1' },
  effectiveTime: '2026-10-01T08:00:00+09:00',
  unit: 'mmHg',
  reviewState: 'reviewed' as const,
};

const evidence: EvidenceItem = {
  ...reference,
  content: 'Synthetic blood pressure: 120/80 mmHg.',
};

const emptyEvidence: EvidenceBatch = { items: [], coverage: [], conflicts: [] };

const completeEvidence: EvidenceBatch = {
  items: [evidence],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['record-1'],
      gaps: [],
      truncated: false,
      resultLimit: 5,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

function makeTask(): TaskResponderContract<{ summary: string }> {
  return {
    taskType: 'synthetic-visit-questions',
    taskVersion: '1',
    systemPrompt: 'Return a cited, cautious visit-preparation result.',
    resultSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary'],
      properties: { summary: { type: 'string' } },
    },
    createMessages: ({ request, evidence: currentEvidence }) => [
      {
        role: 'user',
        content:
          request +
          '\nCurrent evidence:\n' +
          currentEvidence.items.map((item) => item.content).join('\n'),
      },
    ],
    validateResult(value) {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof value.summary !== 'string' ||
        !value.summary.trim()
      ) {
        return { status: 'invalid', reason: 'A summary is required.' };
      }
      return { status: 'valid', value: { summary: value.summary } };
    },
  };
}

function makeProvider(outputs: string[]) {
  const requests: LanguageModelRequest[] = [];
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    requests.push(request);
    const next = outputs.shift();
    if (!next) {
      return providerFailure({
        code: 'internal_error',
        message: 'No scripted response remains.',
        retryable: false,
      });
    }
    return providerSuccess({ text: next, toolCalls: [], finishReason: 'complete' as const });
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
  return { provider, requests, generate };
}

function makeOptions(
  provider: LanguageModelProvider,
  overrides: Partial<MultiAgentWorkflowOptions> = {},
): MultiAgentWorkflowOptions {
  return {
    execution: {
      operationRunId: 'run-117-1',
      providerId: provider.id,
      modelId: 'selected-model',
      recipient: 'chatgpt-plan',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['personal_record'] },
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
    request: 'Prepare evidence-linked questions for the next visit.',
    task: makeTask(),
    initialEvidence: emptyEvidence,
    tools: [
      {
        id: 'local-record-search',
        sourceKind: 'personal_record',
        execution: 'local_read_only',
        async search() {
          return completeEvidence;
        },
      },
    ],
    consent: {
      authorize: jest.fn(async (input) => {
        expect(input.providerId).toBe(provider.id);
        expect(input.modelId).toBe('selected-model');
        return 'authorized';
      }),
    },
    revalidateEvidence: jest.fn(async () => true),
    ...overrides,
  };
}

describe('multi-agent handoff', () => {
  it('passes a responder evidence request through a separate researcher call, then revises from new evidence', async () => {
    const { provider, requests, generate } = makeProvider([
      JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
      JSON.stringify({
        toolId: 'local-record-search',
        sourceKind: 'personal_record',
        query: 'blood pressure from the latest visit',
      }),
      JSON.stringify({
        type: 'result',
        value: { summary: 'Ask about the recorded blood pressure.' },
        citations: [reference],
      }),
    ]);
    const options = makeOptions(provider);
    const search = jest.spyOn(options.tools[0], 'search');

    const result = await runMultiAgentWorkflow(options);

    expect(result).toMatchObject({ status: 'result' });
    if (result.status !== 'result') return;
    expect(result.value).toEqual({ summary: 'Ask about the recorded blood pressure.' });
    expect(result.citations).toEqual([reference]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toMatchObject({
      operationRunId: 'run-117-1',
      operationKey: 'tool-1',
      query: 'blood pressure from the latest visit',
    });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(requests[0]?.responseFormat).toBeUndefined();
    expect(requests[1]?.messages.map((message) => message.content).join('\n')).toEqual(
      expect.stringContaining('missing_coverage'),
    );
    expect(requests[2]?.messages.map((message) => message.content).join('\n')).toContain(
      evidence.content,
    );
    expect(JSON.stringify(result.checkpoint)).not.toContain(evidence.content);
    expect(JSON.stringify(result.checkpoint)).not.toContain(options.request);
    expect(JSON.stringify(result.checkpoint)).not.toContain(
      'Ask about the recorded blood pressure.',
    );
    expect(options.consent.authorize).toHaveBeenCalledTimes(3);
  });

  it('does not force a researcher call when the responder can answer from initial evidence', async () => {
    const { provider, generate } = makeProvider([
      JSON.stringify({
        type: 'result',
        value: { summary: 'Ask about the recorded blood pressure.' },
        citations: [reference],
      }),
    ]);
    const options = makeOptions(provider, { initialEvidence: completeEvidence });
    const search = jest.spyOn(options.tools[0], 'search');

    const result = await runMultiAgentWorkflow(options);

    expect(result.status).toBe('result');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
  });
});
