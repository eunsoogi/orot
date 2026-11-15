import { conversationGeneratedTools } from '../conversationGeneratedTools';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import type { AiFeatureLocalData } from '../localData';

// Synthetic empty catalog pages isolate cursor ownership, not model or database behavior.
test.each([
  ['summaryArtifactDiscovery', 'local-generated-artifacts'],
  ['conversationArtifactDiscovery', 'local-conversation-artifacts'],
] as const)(
  '%s tokens block cold capture across bundle recreation and final pages',
  async (catalog, id) => {
    const search = jest
      .fn()
      .mockResolvedValueOnce({
        items: [],
        unavailableCount: 0,
        nextCursor: 'private-row',
      })
      .mockResolvedValue({ items: [], unavailableCount: 0, nextCursor: null });
    const data = {
      ...localData([]).data,
      [catalog]: async () => ({ search }),
    } as unknown as AiFeatureLocalData;
    const registry = new LocalEvidenceReferenceRegistry();
    const generated = conversationGeneratedTools(data, registry, undefined);
    const request = {
      operationRunId: 'original-run',
      operationKey: 'page',
      input: { query: 'synthetic' },
      allowedScope: { sourceKinds: ['generated_artifact' as const] },
      resultLimit: 1,
      maxPayloadBytes: 2048,
      signal: new AbortController().signal,
    };
    expect(generated.hasPagingState()).toBe(false);
    const tool = generated.tools.find(value => value.id === id)!;
    const first = await tool.search(request);
    if ('status' in first) throw new Error('Unexpected consent');
    const cursor = first.coverage[0]!.nextCursor;
    if (!cursor) throw new Error('Missing continuation');
    expect(JSON.stringify(first)).not.toContain('private-row');
    expect(generated.hasPagingState()).toBe(true);
    const recreated = conversationGeneratedTools(data, registry, undefined);
    expect(recreated.hasPagingState()).toBe(true);
    await recreated.tools
      .find(value => value.id === id)!
      .search({ ...request, input: { query: 'synthetic', cursor } });
    expect(search.mock.calls[1][0].cursor).toBe('private-row');
    expect(recreated.hasPagingState()).toBe(true);
    const isolated = conversationGeneratedTools(
      data,
      new LocalEvidenceReferenceRegistry(),
      undefined,
    );
    expect(isolated.hasPagingState()).toBe(false);
    await expect(
      isolated.tools
        .find(value => value.id === id)!
        .search({ ...request, input: { query: 'synthetic', cursor } }),
    ).rejects.toThrow('cursor');
    await expect(
      tool.search({
        ...request,
        operationRunId: 'other-run',
        input: { query: 'synthetic', cursor },
      }),
    ).rejects.toThrow('cursor');
    expect(search).toHaveBeenCalledTimes(2);
  },
);

test('empty catalog results without any continuation token remain eligible', async () => {
  const data = {
    ...localData([]).data,
    summaryArtifactDiscovery: async () => ({
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
    .find(value => value.id === 'local-generated-artifacts')!
    .search({
      operationRunId: 'run',
      operationKey: 'page',
      input: { query: 'synthetic' },
      allowedScope: { sourceKinds: ['generated_artifact'] },
      resultLimit: 1,
      maxPayloadBytes: 2048,
      signal: new AbortController().signal,
    });
  expect(generated.hasPagingState()).toBe(false);
});
