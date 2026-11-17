import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

/** Exercise the production graph rather than only the policy accessor: twelve searches exceed
 * the old tool/model quotas and LangGraph's default step count, while retaining consent. */
function fixture(cancelAfter?: number) {
  const controller = new AbortController();
  let searched = 0;
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: ++searched === 12 ? [publication] : [],
  }));
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: { authorize: async () => 'authorized' },
  });
  const base = makeProvider([]).provider;
  const requests: LanguageModelRequest[] = [];
  const provider = {
    ...base,
    capabilities: {
      ...base.capabilities,
      toolCalling: true,
      requestControls: ['maxOutputTokens'] as const,
    },
    generate: async (request: LanguageModelRequest) => {
      requests.push(request);
      if (requests.length === cancelAfter) controller.abort();
      return requests.length <= 12
        ? providerSuccess({
            text: '',
            toolCalls: [
              {
                id: `call-${requests.length}`,
                name: tool.id,
                arguments: { query: `query ${requests.length}` },
              },
            ],
            finishReason: 'tool_calls' as const,
          })
        : providerSuccess({
            text: JSON.stringify({
              ...JSON.parse(scriptedOutputs()[2]!),
              value: { summary: 'x'.repeat(70_000) },
            }),
            toolCalls: [],
            finishReason: 'complete' as const,
          });
    },
  };
  const original = workflowOptions(provider, tool);
  const options = {
    ...original,
    execution: {
      ...original.execution,
      budget: {
        ...original.execution.budget,
        executionLimits: 'unbounded' as const,
        timeoutMs: null,
      },
    },
  };
  return { controller, search, requests, options };
}

test('unbounded interactive execution keeps searching beyond old quotas and accepts a large final answer', async () => {
  const f = fixture();
  const result = await runMultiAgentWorkflow(f.options, { signal: f.controller.signal });
  expect(result.status).toBe('result');
  expect(f.search).toHaveBeenCalledTimes(12);
  expect(f.requests).toHaveLength(13);
  expect(f.requests.every((request) => request.maxOutputTokens === undefined)).toBe(true);
  expect(f.options.consent.authorize).toHaveBeenCalledTimes(13);
  expect(result.status === 'result' && result.value.summary).toHaveLength(70_000);
});

test('unbounded execution still stops immediately on explicit cancellation', async () => {
  const f = fixture(10);
  const result = await runMultiAgentWorkflow(f.options, { signal: f.controller.signal });
  expect(result.status).toBe('cancelled');
  expect(f.requests).toHaveLength(10);
  expect(f.search).toHaveBeenCalledTimes(9);
});

test('unbounded execution cannot bypass exact-request consent or source freshness', async () => {
  const denied = fixture();
  denied.options.consent.authorize = jest.fn(async () => 'denied');
  expect((await runMultiAgentWorkflow(denied.options)).status).toBe('consent_required');
  expect(denied.requests).toHaveLength(0);
  const stale = fixture();
  stale.options.revalidateEvidence = jest.fn(async () => false);
  expect((await runMultiAgentWorkflow(stale.options)).status).toBe('stale_evidence');
  expect(stale.requests).toHaveLength(12);
});
