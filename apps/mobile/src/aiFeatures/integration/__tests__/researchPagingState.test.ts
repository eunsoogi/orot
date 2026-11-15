import { createResearchPagingState } from '../researchPagingState';
import { createResearchArtifactTool } from '../researchArtifactTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import type { AiFeatureLocalData } from '../localData';

const snapshot = {
  version: 1,
  sequence: 1,
  tokens: [
    {
      token: 'research-page-1',
      scope: 'run',
      query: 'synthetic',
      cursor: 'research-9',
    },
  ],
};
const request = {
  operationRunId: 'run',
  operationKey: 'next',
  input: { query: 'synthetic', cursor: 'research-page-1' },
  allowedScope: { sourceKinds: ['generated_artifact' as const] },
  resultLimit: 1,
  maxPayloadBytes: 2048,
  signal: new AbortController().signal,
};

test('fresh research tool resumes the saved next page without repeating the initial search', async () => {
  const search = jest.fn().mockResolvedValue({
    items: [],
    unavailableCount: 0,
    nextCursor: 'research-4',
  });
  const data = {
    ...localData([]).data,
    researchArtifactDiscovery: async () => ({ search }),
  } as unknown as AiFeatureLocalData;
  const paging = createResearchPagingState({ snapshot, operationRunId: 'run' });
  const tool = createResearchArtifactTool(
    data,
    new LocalEvidenceReferenceRegistry(),
    undefined,
    paging,
  );
  const result = await tool.search(request);
  expect(search).toHaveBeenCalledTimes(1);
  expect(search.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({ query: 'synthetic', cursor: 'research-9' }),
  );
  expect(JSON.stringify(result)).not.toContain('research-9');
  expect(paging.snapshot('run').tokens.map(row => row.token)).toEqual([
    'research-page-1',
    'research-page-2',
  ]);
  await expect(
    tool.search({ ...request, operationRunId: 'other' }),
  ).rejects.toThrow('cursor');
  await expect(
    tool.search({
      ...request,
      input: { ...request.input, query: 'different' },
    }),
  ).rejects.toThrow('cursor');
  expect(search).toHaveBeenCalledTimes(1);
});

test.each([
  { ...snapshot, version: 2 },
  { ...snapshot, sequence: 0 },
  { ...snapshot, tokens: [...snapshot.tokens, ...snapshot.tokens] },
  { ...snapshot, tokens: [{ ...snapshot.tokens[0], scope: 'other' }] },
  {
    ...snapshot,
    tokens: [{ ...snapshot.tokens[0], cursor: 'raw-other-catalog' }],
  },
  { ...snapshot, tokens: [{ ...snapshot.tokens[0], query: ' synthetic ' }] },
  { ...snapshot, extra: 'unexpected' },
])(
  'malformed or foreign protected cursor state is rejected before any search',
  value => {
    expect(() =>
      createResearchPagingState({ snapshot: value, operationRunId: 'run' }),
    ).toThrow();
  },
);

test('snapshots are detached and bound to the original run', () => {
  const value = JSON.parse(JSON.stringify(snapshot));
  const paging = createResearchPagingState({
    snapshot: value,
    operationRunId: 'run',
  });
  value.tokens[0].cursor = 'research-100';
  const first = paging.snapshot('run');
  first.tokens[0]!.cursor = 'research-101';
  expect(paging.snapshot('run').tokens[0]!.cursor).toBe('research-9');
  expect(() => paging.snapshot('foreign-run')).toThrow();
});
