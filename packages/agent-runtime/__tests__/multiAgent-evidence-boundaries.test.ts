import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
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
  sourceRevision: 'record-revision-1',
  evidenceId: 'observation-1',
  evidenceRevision: 'evidence-revision-1',
  locator: { kind: 'structured_record', recordId: 'observation-1' },
  effectiveTime: '2026-10-01T08:00:00Z',
  unit: 'mmHg',
  reviewState: 'reviewed',
};

function completeBatch(): EvidenceBatch {
  return {
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
}

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
    createMessages: ({ request }) => [{ role: 'user', content: request }],
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

function workflowOptions(initialEvidence: EvidenceBatch, output?: string) {
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
    generate: jest.fn(async () =>
      providerSuccess({
        text:
          output ??
          JSON.stringify({
            type: 'result',
            value: { summary: 'Ask about the recorded blood pressure.' },
            citations: initialEvidence.items.length > 0 ? [reference] : [],
          }),
        toolCalls: [],
        finishReason: 'complete',
      }),
    ),
  };
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    execution: {
      operationRunId: 'run-evidence-boundary',
      providerId: provider.id,
      modelId: 'model-evidence-boundary',
      recipient: 'selected-account',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: ['record-1'] },
      budget: {
        maxModelCalls: 3,
        maxToolCalls: 1,
        maxResearchCycles: 1,
        maxPayloadBytes: 32_000,
        maxOutputTokens: 512,
        timeoutMs: 5_000,
        maxEvidenceItems: 5,
      },
    },
    provider,
    request: 'Prepare synthetic visit questions.',
    task: responder(),
    initialEvidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
  return options;
}

function runWithEvidence(initialEvidence: EvidenceBatch, output?: string) {
  return runMultiAgentWorkflow(workflowOptions(initialEvidence, output));
}

describe('multi-agent evidence boundaries', () => {
  it.each(['truncated', 'gaps', 'conflicts', 'missing coverage', 'no items'])(
    'requires clarification when initial evidence has %s',
    async (kind) => {
      const batch = completeBatch();
      const incomplete: EvidenceBatch =
        kind === 'truncated'
          ? { ...batch, coverage: [{ ...batch.coverage[0]!, truncated: true }] }
          : kind === 'gaps'
            ? {
                ...batch,
                coverage: [{ ...batch.coverage[0]!, gaps: ['Older records were not searched.'] }],
              }
            : kind === 'conflicts'
              ? { ...batch, conflicts: ['Two current values disagree.'] }
              : kind === 'missing coverage'
                ? { ...batch, coverage: [] }
                : { items: [], coverage: [], conflicts: [] };

      const result = await runWithEvidence(incomplete);

      expect(result.status).toBe('needs_clarification');
    },
  );

  it('allows an evidence request to resolve empty initial coverage before returning a result', async () => {
    const empty: EvidenceBatch = { items: [], coverage: [], conflicts: [] };
    const outputs = [
      JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
      JSON.stringify({
        toolId: 'local-search',
        sourceKind: 'personal_record',
        input: { query: 'selected observation' },
      }),
      JSON.stringify({
        type: 'result',
        value: { summary: 'Ask about the recorded blood pressure.' },
        citations: [reference],
      }),
    ];
    const base = workflowOptions(empty);
    const generate = jest.fn(async () =>
      providerSuccess({ text: outputs.shift() ?? '{}', toolCalls: [], finishReason: 'complete' }),
    );
    const provider = { ...base.provider, generate };
    const search = jest.fn(async () => completeBatch());
    const tool: EvidenceSearchTool = {
      id: 'local-search',
      sourceKind: 'personal_record',
      execution: 'local_read_only',
      description: 'Read one bounded local observation.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1 } },
        required: ['query'],
        additionalProperties: false,
      },
      parseInput(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const query = (value as Record<string, unknown>).query;
        return typeof query === 'string' && query.trim() ? { query: query.trim() } : undefined;
      },
      search,
    };

    const result = await runMultiAgentWorkflow({ ...base, provider, tools: [tool] });

    expect(result.status).toBe('result');
    expect(generate).toHaveBeenCalledTimes(3);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('projects evidence references before checkpoint and citation output', async () => {
    const privateValue = 'SYNTHETIC_PRIVATE_TRANSCRIPT';
    const batch = completeBatch();
    const evidenceWithExtraPayload = {
      ...batch,
      items: [{ ...batch.items[0]!, rawTranscript: privateValue }],
    } as unknown as EvidenceBatch;

    const result = await runWithEvidence(evidenceWithExtraPayload);

    expect(result.status).toBe('result');
    expect(result.citations).toEqual([reference]);
    expect(result.checkpoint.evidenceReferences).toEqual([reference]);
    expect(JSON.stringify(result.checkpoint)).not.toContain(privateValue);
  });
});
