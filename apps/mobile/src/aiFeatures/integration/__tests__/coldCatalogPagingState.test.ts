import { conversationGeneratedTools } from '../conversationGeneratedTools';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import type { AiFeatureLocalData } from '../localData';

// Synthetic catalogs exercise production tools and protected chooser reconstruction, not SQLite/OS behavior.
test.each([
  ['summaryArtifactDiscovery', 'local-generated-artifacts'],
  ['conversationArtifactDiscovery', 'local-conversation-artifacts'],
] as const)(
  '%s resumes only the saved next page under a fresh owner scope',
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
    const generated = conversationGeneratedTools(
      data,
      new LocalEvidenceReferenceRegistry(),
      { conversationScope: 'old-scope' },
    );
    const request = {
      operationRunId: 'original-run',
      operationKey: 'page',
      input: { query: 'synthetic' },
      allowedScope: { sourceKinds: ['generated_artifact' as const] },
      resultLimit: 1,
      maxPayloadBytes: 2048,
      signal: new AbortController().signal,
    };
    await generated.tools.find(tool => tool.id === id)!.search(request);
    const continuation = generated.choose({ status: 'no_evidence' });
    expect(continuation).not.toBeNull();
    const saved = generated.artifactPagingSnapshot!();
    const restored = conversationGeneratedTools(
      data,
      new LocalEvidenceReferenceRegistry(),
      { conversationScope: 'new-scope' },
      undefined,
      saved,
    );
    expect(search).toHaveBeenCalledTimes(1); // Reconstruction performs no discovery dispatch.
    expect(restored.choose({ status: 'no_evidence' })).toEqual(continuation);
    const tool = restored.tools.find(value => value.id === id)!;
    await expect(
      tool.search({
        ...request,
        input: { query: 'changed', cursor: continuation!.cursor },
      }),
    ).rejects.toThrow('cursor');
    expect(search).toHaveBeenCalledTimes(1);
    await tool.search({
      ...request,
      input: { query: 'synthetic', cursor: continuation!.cursor },
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][0].cursor).toBe('private-row');
    expect(restored.choose({ status: 'no_evidence' })).toBeNull();
    expect(JSON.stringify(continuation)).not.toContain('private-row');
    expect(() =>
      conversationGeneratedTools(
        data,
        new LocalEvidenceReferenceRegistry(),
        undefined,
        undefined,
        saved,
      ),
    ).toThrow('owner unavailable');
  },
);
