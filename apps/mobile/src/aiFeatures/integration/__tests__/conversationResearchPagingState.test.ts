import { conversationGeneratedTools } from '../conversationGeneratedTools';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import type { AiFeatureLocalData } from '../localData';

// Synthetic empty pages isolate the tool's private token ownership, without provider calls.
test('research cursor state blocks cold capture even after its final page', async () => {
  const search = jest
    .fn()
    .mockResolvedValueOnce({
      items: [],
      unavailableCount: 0,
      nextCursor: 'private-page-cursor',
    })
    .mockResolvedValue({ items: [], unavailableCount: 0, nextCursor: null });
  const data = {
    ...localData([]).data,
    researchArtifactDiscovery: async () => ({ search }),
  } as unknown as AiFeatureLocalData;
  const generated = conversationGeneratedTools(
    data,
    new LocalEvidenceReferenceRegistry(),
    undefined,
  );
  const tool = generated.tools.find(
    value => value.id === 'local-research-artifacts',
  )!;
  const request = {
    operationRunId: 'original-run',
    operationKey: 'research',
    input: { query: 'synthetic' },
    allowedScope: { sourceKinds: ['generated_artifact' as const] },
    resultLimit: 1,
    maxPayloadBytes: 2048,
    signal: new AbortController().signal,
  };
  expect(generated.hasPagingState()).toBe(false);
  const page = await tool.search(request);
  if ('status' in page) throw new Error('Unexpected consent');
  const cursor = page.coverage[0]!.nextCursor;
  expect(cursor).toBe('research-page-1');
  if (!cursor) throw new Error('Missing continuation token');
  expect(JSON.stringify(page)).not.toContain('private-page-cursor');
  expect(generated.hasPagingState()).toBe(true);
  await tool.search({ ...request, input: { query: 'synthetic', cursor } });
  expect(search.mock.calls[1][0].cursor).toBe('private-page-cursor');
  expect(generated.hasPagingState()).toBe(true);
  const isolated = conversationGeneratedTools(
    data,
    new LocalEvidenceReferenceRegistry(),
    undefined,
  );
  expect(isolated.hasPagingState()).toBe(false);
  await expect(
    isolated.tools
      .find(value => value.id === tool.id)!
      .search({ ...request, input: { query: 'synthetic', cursor } }),
  ).rejects.toThrow('cursor');
  expect(search).toHaveBeenCalledTimes(2);
});

test('a research result without a cursor does not disable supported cold continuation', async () => {
  const data = {
    ...localData([]).data,
    researchArtifactDiscovery: async () => ({
      search: async () => ({
        items: [],
        unavailableCount: 0,
        nextCursor: null,
      }),
    }),
  } as unknown as AiFeatureLocalData;
  const generated = conversationGeneratedTools(
    data,
    new LocalEvidenceReferenceRegistry(),
    undefined,
  );
  await generated.tools
    .find(value => value.id === 'local-research-artifacts')!
    .search({
      operationRunId: 'run',
      operationKey: 'research',
      input: { query: 'synthetic' },
      allowedScope: { sourceKinds: ['generated_artifact'] },
      resultLimit: 1,
      maxPayloadBytes: 2048,
      signal: new AbortController().signal,
    });
  expect(generated.hasPagingState()).toBe(false);
});
