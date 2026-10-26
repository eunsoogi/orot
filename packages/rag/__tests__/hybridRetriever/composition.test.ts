import { Document } from '@langchain/core/documents';
import { chunk, document, setup } from './fixtures';

describe('standard hybrid retriever composition', () => {
  it('uses existing weighted RRF for shared, lexical-only and vector-only documents', async () => {
    const page = ['lexical-only', 'shared', 'vector-only'].map(chunk);
    const { retriever } = setup(page, page.slice(0, 2).map(document), page.slice(1).map(document), {
      ranking: { lexicalWeight: 5, vectorWeight: 1, rrfConstant: 1, candidateLimit: 3 },
    });
    const documents = await retriever.invoke('consultation');
    // Existing RRF gives 5/2, 5/3+1/2, and 1/3, respectively.
    expect(documents.map((item) => item.id)).toEqual(['lexical-only', 'shared', 'vector-only']);
    expect(documents.map((item) => item.metadata)).toEqual(page.map((item) => item.metadata));
  });

  it('breaks exact score ties by chunk ID regardless of child completion order', async () => {
    const page = ['z', 'a'].map(chunk);
    const { retriever } = setup(page, [document(page[0])], [document(page[1])]);
    expect((await retriever.invoke('query')).map((item) => item.id)).toEqual(['a', 'z']);
  });

  it('filters before child retrieval and binds the same bounded candidate budget to each child', async () => {
    const page = ['a', 'b', 'c'].map(chunk);
    page[2] = { ...page[2], metadata: { ...page[2].metadata, encounterId: 'excluded' } };
    const filters = {
      encounterId: 'encounter-a',
      recordTypes: ['transcript_segment' as const],
      reviewStates: ['unreviewed' as const],
      timeRange: { start: '2026-10-01T10:00:00Z', end: '2026-10-01T10:00:00Z' },
    };
    const { retriever, input } = setup(page, page.map(document), [], {
      filters,
      limit: 1,
      ranking: { candidateLimit: 2 },
    });
    expect((await retriever.invoke('query')).map((item) => item.id)).toEqual(['a']);
    for (const factory of [input.createLexicalRetriever, input.createVectorRetriever]) {
      expect(factory).toHaveBeenCalledWith({ chunks: page.slice(0, 2), filters, limit: 2 });
    }
  });

  it('caps child results and ignores duplicates, unknown IDs and stale snapshots', async () => {
    const page = ['a', 'b', 'c'].map(chunk);
    const stale = new Document({ ...document(page[1]), pageContent: 'old revision' });
    const { retriever } = setup(
      page,
      [document(page[0]), document(page[0]), stale, document(page[2])],
      [new Document({ id: 'unknown', pageContent: 'unknown', metadata: {} })],
      { limit: 3, ranking: { candidateLimit: 3 } },
    );
    expect((await retriever.invoke('query')).map((item) => item.id)).toEqual(['a']);
  });

  it('rejects metadata-only stale revisions but accepts equivalent property order', async () => {
    const current = chunk('a');
    const stale = document(current);
    stale.metadata.reviewState = { status: 'needs_review', reason: 'stale' };
    const reordered = document(current);
    reordered.metadata = Object.fromEntries(
      Object.entries(reordered.metadata).reverse(),
    ) as typeof reordered.metadata;
    const { retriever } = setup([current], [stale], [reordered]);
    expect(await retriever.invoke('query')).toEqual([document(current)]);
  });

  it('rechecks persisted removal after retrieval and never returns a removed citation', async () => {
    const page = ['a', 'b'].map(chunk);
    const { retriever, removalReader } = setup(page, page.map(document), page.map(document));
    removalReader.findRemovedEvidence
      .mockResolvedValueOnce({ sourceRecordIds: [], chunkIds: [] })
      .mockResolvedValueOnce({ sourceRecordIds: ['source-a'], chunkIds: [] });
    expect((await retriever.invoke('query')).map((item) => item.id)).toEqual(['b']);
  });

  it('skips children for blank queries or an entirely removed page', async () => {
    const page = [chunk('a')];
    const { retriever, lexicalInvoke, vectorInvoke, removalReader } = setup(
      page,
      page.map(document),
      [],
    );
    expect(await retriever.invoke(' ')).toEqual([]);
    removalReader.findRemovedEvidence.mockResolvedValue({ sourceRecordIds: [], chunkIds: ['a'] });
    expect(await retriever.invoke('query')).toEqual([]);
    expect(lexicalInvoke).not.toHaveBeenCalled();
    expect(vectorInvoke).not.toHaveBeenCalled();
  });

  it('rejects invalid counts, weights, pages and filters before invoking children', async () => {
    const page = [chunk('a')];
    for (const limit of [0, 501, NaN, 1.5]) expect(() => setup(page, [], [], { limit })).toThrow();
    expect(() => setup(page, [], [], { ranking: { lexicalWeight: 0, vectorWeight: 0 } })).toThrow();
    expect(() =>
      setup(
        Array.from({ length: 501 }, (_, i) => chunk(String(i))),
        [],
        [],
      ),
    ).toThrow();
    const { retriever } = setup(page, [], [], { filters: { timeRange: { start: 'invalid' } } });
    await expect(retriever.invoke('query')).rejects.toThrow();
    await expect(setup([page[0], page[0]], [], []).retriever.invoke('query')).rejects.toThrow();
  });
});
