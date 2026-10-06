import {
  providerSuccess,
  type JsonObject,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceReference,
  type EvidenceSearchTool,
  type MultiAgentWorkflowOptions,
  type TaskResponderContract,
} from '../src';

const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'record-1',
  sourceRevision: 'record-rev-1',
  evidenceId: 'observation-1',
  evidenceRevision: 'evidence-rev-1',
  locator: { kind: 'structured_record', recordId: 'observation-1' },
  effectiveTime: '2026-10-01T08:00:00+09:00',
  unit: 'mmHg',
  reviewState: 'reviewed',
};

const currentEvidence: EvidenceBatch = {
  items: [{ ...reference, content: 'Synthetic blood pressure: 120/80 mmHg.' }],
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

function responder(): TaskResponderContract<{ summary: string }> {
  return {
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
  };
}

function providerFor(outputs: string[], structuredOutput = false) {
  const requests: LanguageModelRequest[] = [];
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    requests.push(request);
    const text = outputs.shift() ?? '{}';
    return providerSuccess({ text, toolCalls: [], finishReason: 'complete' as const });
  });
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'selected-model',
    displayName: 'Selected model',
    capabilities: { inputTypes: ['text'], streaming: false, structuredOutput, toolCalling: false },
    generate,
  };
  return { provider, requests, generate };
}

function localRecordSearch(search: EvidenceSearchTool['search']): EvidenceSearchTool {
  return {
    id: 'local-record-search',
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description: 'Search selected local records for one bounded evidence need.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    },
    parseInput(value: unknown): JsonObject | undefined {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
      const query = (value as Record<string, unknown>).query;
      return typeof query === 'string' && query.trim() ? { query: query.trim() } : undefined;
    },
    search,
  };
}

function optionsFor(
  provider: LanguageModelProvider,
  overrides: Partial<MultiAgentWorkflowOptions> = {},
): MultiAgentWorkflowOptions {
  return {
    execution: {
      operationRunId: 'run-safe-1',
      providerId: provider.id,
      modelId: 'model-safe-1',
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
    task: responder(),
    initialEvidence: currentEvidence,
    tools: [localRecordSearch(async () => currentEvidence)],
    consent: { authorize: jest.fn(async () => 'authorized' as const) },
    revalidateEvidence: jest.fn(async () => true),
    ...overrides,
  };
}

const validResult = JSON.stringify({
  type: 'result',
  value: { summary: 'Ask about the recorded blood pressure.' },
  citations: [reference],
});

describe('multi-agent safety boundaries', () => {
  it('does not call the revised responder until expanded evidence receives renewed consent', async () => {
    const { provider, generate } = providerFor([
      JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
      JSON.stringify({
        toolId: 'local-record-search',
        sourceKind: 'personal_record',
        input: { query: 'latest blood pressure' },
      }),
      validResult,
    ]);
    const base = optionsFor(provider);
    const authorize = jest
      .fn()
      .mockResolvedValueOnce('authorized')
      .mockResolvedValueOnce('authorized')
      .mockResolvedValueOnce('renewal_required');
    const options = {
      ...base,
      consent: { authorize },
      initialEvidence: { items: [], coverage: [], conflicts: [] },
    };
    const search = jest.spyOn(options.tools[0], 'search');

    const result = await runMultiAgentWorkflow(options);

    expect(result.status).toBe('consent_required');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(3);
  });

  it('rejects citations absent from the validated evidence batch', async () => {
    const { provider, generate } = providerFor([
      JSON.stringify({
        type: 'result',
        value: { summary: 'Unsupported.' },
        citations: [{ ...reference, evidenceRevision: 'forged-revision' }],
      }),
    ]);
    const options = optionsFor(provider);

    const result = await runMultiAgentWorkflow(options);

    expect(result.status).toBe('invalid_output');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.checkpoint)).not.toContain('Unsupported.');
    expect(JSON.stringify(result.checkpoint)).not.toContain('Prepare synthetic visit questions.');
  });

  it('returns coverage gaps instead of asking the responder to fill them with inference', async () => {
    const { provider, generate } = providerFor([
      JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
      JSON.stringify({
        toolId: 'local-record-search',
        sourceKind: 'personal_record',
        input: { query: 'latest blood pressure' },
      }),
      validResult,
    ]);
    const incomplete: EvidenceBatch = {
      ...currentEvidence,
      coverage: [
        {
          ...currentEvidence.coverage[0]!,
          gaps: ['Older visit records were not searched.'],
          truncated: true,
        },
      ],
    };
    const search = jest.fn(async () => incomplete);
    const options = optionsFor(provider, {
      initialEvidence: { items: [], coverage: [], conflicts: [] },
      tools: [localRecordSearch(search)],
    });

    const result = await runMultiAgentWorkflow(options);

    expect(result.status).toBe('needs_clarification');
    expect(result.coverage).toEqual(incomplete.coverage);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('uses structured-output capability but still locally validates the task result', async () => {
    const { provider, requests } = providerFor([validResult], true);
    const result = await runMultiAgentWorkflow(optionsFor(provider));

    expect(requests[0]?.responseFormat?.schema).toBeDefined();
    expect(result.status).toBe('result');
  });
});
