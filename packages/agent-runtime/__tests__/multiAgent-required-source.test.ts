import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';
import {
  createEuropePmcEvidenceSearchTool,
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceSearchTool,
} from '../src';
import {
  makeProvider,
  publication,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

const personal: EvidenceBatch = {
  items: [
    {
      sourceKind: 'personal_record',
      sourceId: 'synthetic-record',
      sourceRevision: '1',
      evidenceId: 'personal-e1',
      evidenceRevision: '1',
      effectiveTime: null,
      reviewState: 'reviewed',
      locator: {},
      content: 'Synthetic source facts',
    },
  ],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['synthetic-record'],
      gaps: [],
      truncated: false,
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

function fixture(skipTool = false, empty = false, denied = false) {
  const search = jest.fn(async (_query: string) => ({
    status: 'available' as const,
    publications: empty ? [] : [publication],
  }));
  const external = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: { authorize: async () => (denied ? 'denied' : 'authorized') },
  });
  const localSearch = jest.fn(async () => personal);
  const local: EvidenceSearchTool = {
    id: 'local-records',
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description: 'Synthetic local tool',
    inputSchema: { type: 'object' },
    parseInput: () => ({}),
    search: localSearch,
  };
  const requests: LanguageModelRequest[] = [];
  const base = makeProvider([]).provider;
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, toolCalling: true },
    generate: async (request: LanguageModelRequest) => {
      requests.push(request);
      if (requests.length === 1 && !skipTool)
        return providerSuccess({
          text: '',
          toolCalls: [
            {
              id: 'medical-1',
              name: external.id,
              arguments: { query: 'model selected public query' },
            },
          ],
          finishReason: 'tool_calls' as const,
        });
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: 'Synthetic supported facts' },
          citations: ['personal-e1', ...(!skipTool && !empty ? ['MED:12345'] : [])],
        }),
        toolCalls: [],
        finishReason: 'complete' as const,
      });
    },
  };
  const baseOptions = workflowOptions(provider, external);
  const options = {
    ...baseOptions,
    initialEvidence: personal,
    tools: [local, external],
    execution: {
      ...baseOptions.execution,
      allowedScope: { sourceKinds: ['personal_record', 'external_medical'] as const },
    },
    task: {
      ...baseOptions.task,
      requiredToolEvidenceKinds: ['personal_record', 'external_medical'] as const,
    },
  };
  return { options, requests, search, localSearch, external };
}

test('requires only the missing source kind while the model chooses its tool and query', async () => {
  const f = fixture();
  expect(f.search).not.toHaveBeenCalled();
  const result = await runMultiAgentWorkflow(f.options);
  expect(result.status).toBe('result');
  expect(f.requests[0]?.toolChoice).toBe('required');
  expect(f.requests[0]?.tools?.map((tool) => tool.name)).toEqual([f.external.id]);
  expect(f.localSearch).not.toHaveBeenCalled();
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(f.search.mock.calls[0]?.[0]).toBe('model selected public query');
  expect(f.requests[1]?.toolChoice).toBeUndefined();
  expect(result.checkpoint.modelCalls).toBe(2);
  expect(result.checkpoint.toolCalls).toBe(1);
});

test('does not accept a personal-only final answer that skipped the required medical lookup', async () => {
  const f = fixture(true);
  const result = await runMultiAgentWorkflow(f.options);
  expect(result.status).toBe('invalid_output');
  expect(f.search).not.toHaveBeenCalled();
  expect(f.localSearch).not.toHaveBeenCalled();
});

test('does not force the same source again after a completed empty search', async () => {
  const f = fixture(false, true);
  await runMultiAgentWorkflow(f.options);
  expect(f.requests[0]?.toolChoice).toBe('required');
  expect(f.requests[1]?.toolChoice).toBeUndefined();
  expect(f.search).toHaveBeenCalledTimes(1);
});

test('the required lookup still stops at exact-query consent without external execution', async () => {
  const f = fixture(false, false, true);
  const result = await runMultiAgentWorkflow(f.options);
  expect(result.status).toBe('consent_required');
  expect(f.search).not.toHaveBeenCalled();
  expect(f.localSearch).not.toHaveBeenCalled();
});

test('does not require or execute a source kind outside the authorized scope', async () => {
  const f = fixture(true);
  const result = await runMultiAgentWorkflow({
    ...f.options,
    execution: { ...f.options.execution, allowedScope: { sourceKinds: ['personal_record'] } },
  });
  // Existing identity validation rejects even registering the out-of-scope tool.
  expect(result.status).toBe('invalid_output');
  expect(f.requests).toHaveLength(0);
  expect(f.search).not.toHaveBeenCalled();
});

test('does not invent an unavailable required tool when the task has only a local adapter', async () => {
  const f = fixture(true);
  const result = await runMultiAgentWorkflow({ ...f.options, tools: [f.options.tools[0]!] });
  expect(result.status).toBe('result');
  expect(f.requests[0]?.toolChoice).toBeUndefined();
  expect(f.search).not.toHaveBeenCalled();
});

test('does not execute a stale local-tool proposal while the missing medical kind is required', async () => {
  const f = fixture();
  const provider = {
    ...f.options.provider,
    generate: async () =>
      providerSuccess({
        text: '',
        toolCalls: [{ id: 'wrong-kind', name: 'local-records', arguments: {} }],
        finishReason: 'tool_calls' as const,
      }),
  };
  const result = await runMultiAgentWorkflow({ ...f.options, provider });
  expect(result.status).toBe('invalid_output');
  expect(f.localSearch).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
});
