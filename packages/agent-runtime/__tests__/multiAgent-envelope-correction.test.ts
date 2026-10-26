import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import { DEFAULT_MULTI_AGENT_BUDGET, runMultiAgentWorkflow } from '../src';
import type { MultiAgentWorkflowOptions, TaskResponderContract } from '../src';

const invalid = () =>
  providerSuccess({
    text: JSON.stringify({ type: 'result', value: 'valid' }),
    toolCalls: [],
    finishReason: 'complete',
  });
const valid = () =>
  providerSuccess({
    text: JSON.stringify({ type: 'result', value: 'valid', citations: ['sample'] }),
    toolCalls: [],
    finishReason: 'complete',
  });

/** Use the complete graph to prove that an opt-in shape repair retains normal budget and validation boundaries. */
function options(
  generate: LanguageModelProvider['generate'],
  optIn = true,
): MultiAgentWorkflowOptions<string> {
  return {
    execution: {
      operationRunId: 'envelope',
      providerId: 'sample',
      modelId: 'sample',
      recipient: 'device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record'] },
      budget: { ...DEFAULT_MULTI_AGENT_BUDGET, timeoutMs: 5000 },
    },
    provider: {
      kind: 'language-model',
      id: 'sample',
      displayName: 'Sample',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate,
    },
    request: 'Synthetic task',
    task: {
      taskType: 'sample',
      taskVersion: '1',
      systemPrompt: 'Synthetic task',
      resultSchema: { type: 'string' },
      createMessages: () => [{ role: 'user', content: 'Synthetic evidence' }],
      validateResult: (value) =>
        value === 'valid' ? { status: 'valid', value } : { status: 'invalid', reason: 'value' },
      ...(optIn
        ? {
            correctionInstructionForInvalidEnvelope: (reason: string) =>
              reason === 'The task responder returned an invalid envelope: citations.'
                ? 'Return the required citations array from current evidence.'
                : undefined,
          }
        : {}),
    } as TaskResponderContract<string>,
    initialEvidence: {
      items: [
        {
          sourceKind: 'personal_record',
          sourceId: 'sample',
          sourceRevision: '1',
          evidenceId: 'sample',
          evidenceRevision: '1',
          reviewState: 'reviewed',
          effectiveTime: null,
          locator: { kind: 'structured_record', recordId: 'sample' },
          content: 'Synthetic evidence',
        },
      ],
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: ['sample'],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

test('allows one opt-in repair of missing citations and validates the corrected references', async () => {
  const generate = jest.fn().mockResolvedValueOnce(invalid()).mockResolvedValueOnce(valid());
  const result = await runMultiAgentWorkflow(options(generate));
  expect(result.status).toBe('result');
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1][0].messages.at(-1).content).toContain('required citations array');
});

test('a second malformed envelope remains invalid rather than looping or inferring citations', async () => {
  const generate = jest.fn(async () => invalid());
  expect((await runMultiAgentWorkflow(options(generate))).status).toBe('invalid_output');
  expect(generate).toHaveBeenCalledTimes(2);
});

test('tasks without explicit envelope opt-in keep the original terminal failure', async () => {
  const generate = jest.fn(async () => invalid());
  expect((await runMultiAgentWorkflow(options(generate, false))).status).toBe('invalid_output');
  expect(generate).toHaveBeenCalledTimes(1);
});

test('shape correction cannot exceed the model-call budget', async () => {
  const generate = jest.fn(async () => invalid());
  const input = options(generate);
  const result = await runMultiAgentWorkflow({
    ...input,
    execution: { ...input.execution, budget: { ...input.execution.budget, maxModelCalls: 1 } },
  });
  expect(result.status).toBe('budget_exceeded');
  expect(generate).toHaveBeenCalledTimes(1);
});

test('corrected envelopes still reject unvalidated citation IDs', async () => {
  const generate = jest
    .fn()
    .mockResolvedValueOnce(invalid())
    .mockResolvedValueOnce(
      providerSuccess({
        text: JSON.stringify({ type: 'result', value: 'valid', citations: ['unknown'] }),
        toolCalls: [],
        finishReason: 'complete',
      }),
    );
  expect((await runMultiAgentWorkflow(options(generate))).status).toBe('invalid_output');
  expect(generate).toHaveBeenCalledTimes(2);
});

test.each([{ ids: ['unknown'] }, { ids: ['sample', 'sample'] }])(
  'allows one explicit citation-binding repair for $ids',
  async ({ ids }) => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce(
        providerSuccess({
          text: JSON.stringify({ type: 'result', value: 'valid', citations: ids }),
          toolCalls: [],
          finishReason: 'complete',
        }),
      )
      .mockResolvedValueOnce(valid());
    const input = options(generate);
    const result = await runMultiAgentWorkflow({
      ...input,
      task: {
        ...input.task,
        correctionInstructionForInvalidEnvelope: (reason) =>
          reason === 'The result cited evidence outside the current validated evidence set.'
            ? 'Return current evidence IDs once each.'
            : undefined,
      },
    });
    expect(result.status).toBe('result');
    expect(generate).toHaveBeenCalledTimes(2);
  },
);

test('a citation-binding correction still stops after a second invalid response', async () => {
  const generate = jest.fn(async () =>
    providerSuccess({
      text: JSON.stringify({ type: 'result', value: 'valid', citations: ['unknown'] }),
      toolCalls: [],
      finishReason: 'complete',
    }),
  );
  const input = options(generate);
  const result = await runMultiAgentWorkflow({
    ...input,
    task: {
      ...input.task,
      correctionInstructionForInvalidEnvelope: (reason) =>
        reason === 'The result cited evidence outside the current validated evidence set.'
          ? 'Return exact current IDs once.'
          : undefined,
    },
  });
  expect(result.status).toBe('invalid_output');
  expect(generate).toHaveBeenCalledTimes(2);
});
