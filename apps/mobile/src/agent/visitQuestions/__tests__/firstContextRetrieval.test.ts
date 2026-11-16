import type { EvidenceSearchRequest } from '@orot/agent-runtime';
import { runVisitQuestionWorkflow } from '../workflow';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';

const combinedInput = {
  days: 30,
  topics: ['measurements', 'sleep'],
  detail: 'weekly',
};

function lookup(id: string, input = combinedInput) {
  return JSON.stringify({
    text: '',
    toolCalls: [{ id, name: 'local-health-context', arguments: input }],
    finishReason: 'tool_calls',
  });
}

// Scripted responses prove allowed workflow paths, not model adherence or speed.
async function run(followUp = false, allow = true) {
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
  const answer = successfulOutputs(
    original.initialEvidence,
    original.supplementalEvidence,
  )[1]!;
  const { provider, requests } = makeProvider([
    lookup('combined-period'),
    ...(followUp
      ? [
          lookup('targeted-detail', {
            days: 30,
            topics: ['measurements'],
            detail: 'daily',
          }),
        ]
      : []),
    answer,
  ]);
  const { selection, option } = selectedOption(provider);
  const confirmConsent = jest.fn(async () => allow);
  const result = await runVisitQuestionWorkflow({
    prepared: {
      ...original,
      healthContextTool: {
        id: 'local-health-context',
        sourceKind: 'personal_record',
        execution: 'local_read_only',
        description: 'Read synthetic context.',
        inputSchema: { type: 'object' },
        parseInput: value => value as typeof combinedInput,
        search,
      },
    },
    selection,
    providerOptions: [option],
    recipient: 'Synthetic account',
    confirmConsent,
  });
  return { result, requests, search, confirmConsent, original };
}

test('delivers scoped first-lookup guidance and accepts one lookup followed by a grounded answer', async () => {
  const f = await run();
  expect(f.result.status).toBe('ready');
  expect(f.requests).toHaveLength(2);
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(f.search).toHaveBeenCalledWith(
    expect.objectContaining({ input: combinedInput }),
  );
  expect(f.confirmConsent).toHaveBeenCalledTimes(2);
  expect(f.original.searchEvidence).not.toHaveBeenCalled();
  const prompt = JSON.stringify(f.requests[0]);
  expect(prompt).toContain('topics relevant to the visit together in one call');
  expect(prompt).toContain('request detail=weekly in that same call');
  expect(prompt).toContain(
    'Do not expand a focused request to unrelated topics',
  );
  expect(prompt).toContain('coverage gaps, truncation and conflicts');
  expect(prompt).toContain('without another lookup merely to reconfirm');
  expect(prompt).toContain('This is not a limit on necessary research');
  expect(prompt).toContain('never treat a gap or a partial sample as absence');
  if (f.result.status === 'ready')
    expect(f.result.questions[0]?.citations).toEqual([
      f.original.supplementalEvidence,
    ]);
});

test('still allows a model-selected targeted daily follow-up with fresh consent', async () => {
  const f = await run(true);
  expect(f.result.status).toBe('ready');
  expect(f.requests).toHaveLength(3);
  expect(f.confirmConsent).toHaveBeenCalledTimes(3);
  expect(f.search).toHaveBeenCalledTimes(2);
  expect(f.search.mock.calls[1]?.[0].input).toEqual({
    days: 30,
    topics: ['measurements'],
    detail: 'daily',
  });
});

test('does not preload records or call the model when initial consent is denied', async () => {
  const f = await run(false, false);
  expect(f.result.status).not.toBe('ready');
  expect(f.requests).toHaveLength(0);
  expect(f.search).not.toHaveBeenCalled();
  expect(f.original.searchEvidence).not.toHaveBeenCalled();
});
