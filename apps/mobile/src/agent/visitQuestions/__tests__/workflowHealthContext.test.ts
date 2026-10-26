import type { EvidenceSearchRequest } from '@orot/agent-runtime';
import { runVisitQuestionWorkflow } from '../workflow';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';

test('executes a model-selected longitudinal tool and restores its citations without raw-record fallback', async () => {
  const original = preparedContext();
  const search = jest.fn(async (_request: EvidenceSearchRequest) => ({
    items: [original.supplementalEvidence],
    coverage: [
      {
        sourceKind: 'personal_record' as const,
        searchedSourceIds: [original.supplementalEvidence.sourceId],
        gaps: [],
        truncated: false,
        resultLimit: 1,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  }));
  const prepared = {
    ...original,
    healthContextTool: {
      id: 'local-health-context',
      sourceKind: 'personal_record' as const,
      execution: 'local_read_only' as const,
      description: 'Read bounded synthetic period health context.',
      inputSchema: { type: 'object' as const },
      parseInput: () => ({ days: 30, topics: ['sleep'], detail: 'weekly' }),
      search,
    },
  };
  const outputs = successfulOutputs(
    original.initialEvidence,
    original.supplementalEvidence,
  );
  outputs[0] = JSON.stringify({
    text: '',
    toolCalls: [
      {
        id: 'period-search',
        name: 'local-health-context',
        arguments: { days: 30, topics: ['sleep'], detail: 'weekly' },
      },
    ],
    finishReason: 'tool_calls',
  });
  const { provider, requests } = makeProvider(outputs);
  const { selection, option } = selectedOption(provider);
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
    recipient: 'Synthetic selected account',
    confirmConsent: async () => true,
  });
  expect(search).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({
      input: { days: 30, topics: ['sleep'], detail: 'weekly' },
    }),
  );
  expect(original.searchEvidence).not.toHaveBeenCalled();
  expect(result.status).toBe('ready');
  if (result.status === 'ready')
    expect(result.questions[0]?.citations).toEqual([
      original.supplementalEvidence,
    ]);
  expect(requests).toHaveLength(2);
  expect(JSON.stringify(requests)).not.toContain('private-source-');
});
