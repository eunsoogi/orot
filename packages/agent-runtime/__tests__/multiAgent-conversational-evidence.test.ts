import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  publication,
  reference,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

function setup(outputs: readonly Record<string, unknown>[]) {
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: [publication],
  }));
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: { authorize: async () => 'authorized' },
  });
  const requests: LanguageModelRequest[] = [];
  const base = makeProvider([]).provider;
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, toolCalling: true },
    generate: jest.fn(async (request: LanguageModelRequest) => {
      requests.push(request);
      const output = outputs[requests.length - 1];
      if (!output) throw new Error('Unexpected fixture request');
      return providerSuccess(
        output.toolCalls
          ? { text: '', toolCalls: output.toolCalls as never, finishReason: 'tool_calls' as const }
          : { text: JSON.stringify(output), toolCalls: [], finishReason: 'complete' as const },
      );
    }),
  };
  const baseOptions = workflowOptions(provider, tool);
  const task = {
    ...baseOptions.task,
    isEvidenceIndependentResult: (value: unknown) =>
      typeof value === 'object' &&
      value !== null &&
      'kind' in value &&
      value.kind === 'conversation',
  };
  return { requests, search, options: { ...baseOptions, task } };
}

const conversation = {
  type: 'result',
  value: { summary: '천만에요. 더 궁금한 점이 있나요?', kind: 'conversation' },
  citations: [],
};
const grounded = {
  type: 'result',
  value: { summary: 'Synthetic cited result' },
  citations: [reference],
};
const searchCall = {
  toolCalls: [
    {
      id: 'search-1',
      name: 'europe-pmc-publication-search',
      arguments: { query: 'synthetic query' },
    },
  ],
};

test('allows an opted-in uncited conversation despite absent or incomplete evidence, without forcing a tool', async () => {
  const fixture = setup([conversation]);
  const result = await runMultiAgentWorkflow({
    ...fixture.options,
    initialEvidence: {
      items: [],
      coverage: [
        {
          sourceKind: 'external_medical',
          searchedSourceIds: [],
          gaps: ['not searched'],
          truncated: false,
          returnedCount: 0,
          resultLimit: 5,
        },
      ],
      conflicts: [],
    },
  });
  expect(result.status).toBe('result');
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.requests[0]?.toolChoice).toBeUndefined();
  expect(fixture.search).not.toHaveBeenCalled();
});

test('forces a model-selected search before accepting an evidence-dependent answer with no evidence', async () => {
  const fixture = setup([{ ...grounded, citations: [] }, searchCall, grounded]);
  const result = await runMultiAgentWorkflow(fixture.options);
  expect(result.status).toBe('result');
  expect(fixture.requests).toHaveLength(3);
  expect(fixture.requests[0]?.toolChoice).toBeUndefined();
  expect(fixture.requests[1]?.toolChoice).toBe('required');
  expect(fixture.search).toHaveBeenCalledTimes(1);
  expect(result.checkpoint.modelCalls).toBe(3);
  expect(result.checkpoint.toolCalls).toBe(1);
});

test('executes a directly chosen tool without an extra classification call', async () => {
  const fixture = setup([searchCall, grounded]);
  const result = await runMultiAgentWorkflow(fixture.options);
  expect(result.status).toBe('result');
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.search).toHaveBeenCalledTimes(1);
  expect(result.checkpoint.modelCalls).toBe(2);
});

test('still blocks an evidence-dependent result when current coverage has gaps', async () => {
  const fixture = setup([grounded]);
  const result = await runMultiAgentWorkflow({
    ...fixture.options,
    initialEvidence: {
      items: [{ ...reference, content: 'Synthetic source' }],
      coverage: [
        {
          sourceKind: 'external_medical',
          searchedSourceIds: ['europe-pmc'],
          gaps: ['missing abstract'],
          truncated: false,
          returnedCount: 1,
          resultLimit: 5,
        },
      ],
      conflicts: [],
    },
  });
  expect(result.status).toBe('needs_clarification');
  expect(fixture.search).not.toHaveBeenCalled();
});

test('rejects a provider that ignores the forced search instead of returning its unsupported final answer', async () => {
  const fixture = setup([
    { ...grounded, citations: [] },
    { ...grounded, citations: [] },
  ]);
  const result = await runMultiAgentWorkflow(fixture.options);
  expect(result.status).toBe('invalid_output');
  expect(fixture.search).not.toHaveBeenCalled();
});

test('does not let a conversational tag bypass citation binding or task validation', async () => {
  const fixture = setup([{ ...conversation, citations: [reference] }]);
  expect((await runMultiAgentWorkflow(fixture.options)).status).not.toBe('result');
  const invalid = setup([{ ...conversation, value: { kind: 'conversation' } }]);
  expect((await runMultiAgentWorkflow(invalid.options)).status).not.toBe('result');
});

test('keeps explicit source-kind requirements even for an opted-in conversation', async () => {
  const fixture = setup([conversation]);
  const result = await runMultiAgentWorkflow({
    ...fixture.options,
    task: { ...fixture.options.task, requiredToolEvidenceKinds: ['external_medical'] },
  });
  expect(result.status).toBe('invalid_output');
  expect(fixture.requests[0]?.toolChoice).toBe('required');
});

test('cannot use the opt-in when the task predicate throws', async () => {
  const fixture = setup([conversation]);
  const result = await runMultiAgentWorkflow({
    ...fixture.options,
    tools: [],
    task: {
      ...fixture.options.task,
      isEvidenceIndependentResult() {
        throw new Error('Invalid task policy');
      },
    },
  });
  expect(result.status).not.toBe('result');
});

test('never dispatches without consent and never exceeds the original model budget', async () => {
  const denied = setup([conversation]);
  const deniedResult = await runMultiAgentWorkflow({
    ...denied.options,
    consent: { authorize: async () => 'denied' },
  });
  expect(deniedResult.status).not.toBe('result');
  expect(denied.requests).toHaveLength(0);
  const bounded = setup([{ ...grounded, citations: [] }, searchCall]);
  const result = await runMultiAgentWorkflow({
    ...bounded.options,
    execution: {
      ...bounded.options.execution,
      budget: { ...bounded.options.execution.budget, maxModelCalls: 2 },
    },
  });
  expect(result.status).not.toBe('result');
  expect(bounded.requests.length).toBeLessThanOrEqual(2);
  expect(bounded.search).not.toHaveBeenCalled();
});
