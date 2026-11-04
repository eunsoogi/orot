import { providerSuccess, type JsonObject, type LanguageModelProvider } from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceSearchTool,
  type MultiAgentWorkflowOptions,
  type TaskResponderContract,
} from '../src';

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'r1',
  sourceRevision: '1',
  evidenceId: 'e1',
  evidenceRevision: '1',
  locator: { recordId: 'r1' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
};
const partial: EvidenceBatch = {
  items: [{ ...reference, content: 'Synthetic record' }],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['r1'],
      gaps: ['A source was unavailable'],
      truncated: false,
      resultLimit: 5,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};
const answer = JSON.stringify({
  type: 'result',
  value: { summary: 'Cited observation' },
  citations: ['e1'],
});

function fixture(outputs = [answer]) {
  const generate = jest.fn(async () =>
    providerSuccess({
      text: outputs.shift() ?? '{}',
      toolCalls: [],
      finishReason: 'complete' as const,
    }),
  );
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'fixture',
    displayName: 'Fixture',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate,
  };
  const task: TaskResponderContract<{ summary: string }> = {
    taskType: 'partial-fixture',
    taskVersion: '1',
    systemPrompt: 'Cite the current evidence.',
    resultSchema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
    createMessages: () => [{ role: 'user', content: 'Summarize the record.' }],
    validateResult(value) {
      return value &&
        !Array.isArray(value) &&
        typeof value === 'object' &&
        typeof value.summary === 'string'
        ? { status: 'valid', value: { summary: value.summary } }
        : { status: 'invalid', reason: 'Invalid summary' };
    },
  };
  const revalidateEvidence = jest.fn(async () => true);
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    execution: {
      operationRunId: 'partial-test',
      providerId: provider.id,
      modelId: 'fixture',
      recipient: 'fixture',
      remoteProcessing: false,
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
    task,
    request: 'Summarize.',
    initialEvidence: partial,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence,
  };
  return { options, generate, revalidateEvidence };
}

test('keeps the existing coverage stop without explicit task opt-in', async () => {
  const { options } = fixture();
  expect((await runMultiAgentWorkflow(options)).status).toBe('needs_clarification');
});

test('opt-in retains validated value and coverage while marking a cited partial result', async () => {
  const { options, revalidateEvidence } = fixture();
  const result = await runMultiAgentWorkflow({
    ...options,
    task: { ...options.task, allowPartialEvidence: true },
  });
  expect(result.status).toBe('result');
  if (result.status !== 'result') return;
  expect(result.value.summary).toBe('Cited observation');
  expect(result.partialEvidence).toBe(true);
  expect(result.coverage).toEqual(partial.coverage);
  expect(result.citations).toEqual([reference]);
  expect(revalidateEvidence).toHaveBeenCalled();
});

test.each(['conflict', 'empty', 'no coverage', 'invalid opt-in'] as const)(
  'fails closed for %s',
  async (kind) => {
    const { options } = fixture();
    const initialEvidence = {
      ...partial,
      ...(kind === 'conflict' ? { conflicts: ['unattributed conflict'] } : {}),
      ...(kind === 'empty' ? { items: [] } : {}),
      ...(kind === 'no coverage' ? { coverage: [] } : {}),
    };
    const result = await runMultiAgentWorkflow({
      ...options,
      initialEvidence,
      task: {
        ...options.task,
        allowPartialEvidence: kind === 'invalid opt-in' ? ('yes' as never) : true,
      },
    });
    expect(result.status).not.toBe('result');
  },
);

test('permits a researched partial batch only for an opted-in task', async () => {
  const { options } = fixture([
    JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
    JSON.stringify({
      toolId: 'local-record-search',
      sourceKind: 'personal_record',
      input: { query: 'synthetic' },
    }),
    answer,
  ]);
  const tool: EvidenceSearchTool = {
    id: 'local-record-search',
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description: 'Search synthetic records.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    parseInput(value) {
      return value as JsonObject;
    },
    search: async () => partial,
  };
  const result = await runMultiAgentWorkflow({
    ...options,
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [tool],
    task: {
      ...options.task,
      allowPartialEvidence: true,
    },
  });
  expect(result.status).toBe('result');
  if (result.status === 'result') expect(result.coverage).toEqual(partial.coverage);
});

test('rejects uncited partial output', async () => {
  const { options } = fixture([
    JSON.stringify({ type: 'result', value: { summary: 'Uncited' }, citations: [] }),
  ]);
  const result = await runMultiAgentWorkflow({
    ...options,
    task: { ...options.task, allowPartialEvidence: true },
  });
  expect(result.status).toBe('invalid_output');
});

test('does not invoke or apply an unrecognized policy callback', async () => {
  const { options } = fixture();
  const finalize = jest.fn(() => ({ status: 'valid', value: { summary: 'Replacement' } }));
  const task = { ...options.task, allowPartialEvidence: true, partialEvidence: { finalize } };
  const result = await runMultiAgentWorkflow({
    ...options,
    task,
  });
  expect(finalize).not.toHaveBeenCalled();
  expect(result.status).toBe('result');
  if (result.status === 'result') expect(result.value.summary).toBe('Cited observation');
});
