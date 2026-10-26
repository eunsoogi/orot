import { HybridRetriever, evidenceChunkToDocument } from '../../src';
import { chunk, document, setup, withPrivateCallbackContext } from './fixtures';

describe('rank-preserving hybrid retrieval', () => {
  it('exports the standard retriever and returns exact weighted ranks in one child pass', async () => {
    const page = [chunk('a'), chunk('b'), chunk('c')];
    const { retriever, lexicalInvoke, vectorInvoke } = setup(
      page,
      [document(page[1]), document(page[0])],
      [document(page[0]), document(page[2])],
      { ranking: { lexicalWeight: 2, vectorWeight: 1, rrfConstant: 0 }, limit: 2 },
    );
    expect(retriever).toBeInstanceOf(HybridRetriever);
    expect(await retriever.searchHits('synthetic')).toEqual([
      { chunk: page[0], score: 2, lexicalRank: 2, vectorRank: 1 },
      { chunk: page[1], score: 2, lexicalRank: 1, vectorRank: null },
    ]);
    expect(lexicalInvoke).toHaveBeenCalledTimes(1);
    expect(vectorInvoke).toHaveBeenCalledTimes(1);
    expect(await retriever.invoke('synthetic')).toEqual(
      page.slice(0, 2).map(evidenceChunkToDocument),
    );
    expect(lexicalInvoke).toHaveBeenCalledTimes(2);
    expect(vectorInvoke).toHaveBeenCalledTimes(2);
    expect(page[0].metadata).not.toHaveProperty('score');
  });

  it('retains the deletion fence and rejects stale metadata in the hit-returning path', async () => {
    const page = [chunk('a'), chunk('b')];
    const stale = document({ ...page[1], text: 'previous revision' });
    const { retriever, removalReader, lexicalInvoke } = setup(page, [document(page[0]), stale], []);
    lexicalInvoke.mockImplementation(async () => {
      removalReader.findRemovedEvidence.mockResolvedValue({ sourceRecordIds: [], chunkIds: ['a'] });
      return [document(page[0]), stale];
    });
    expect(await retriever.searchHits('synthetic')).toEqual([]);
  });

  it('keeps concurrent controls private and rejects an aborted hit request before child execution', async () => {
    await withPrivateCallbackContext(async (seen, handler, consoleLog) => {
      const page = [chunk('a')];
      const { retriever, lexicalInvoke } = setup(page, page.map(document), [], {
        callbacks: [handler],
      });
      const controller = new AbortController();
      controller.abort();
      await expect(
        retriever.searchHits('private', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(lexicalInvoke).not.toHaveBeenCalled();
      const [hits, documents] = await Promise.all([
        retriever.searchHits('private hits', { callbacks: [handler] }),
        retriever.invoke('private docs', { callbacks: [handler] }),
      ]);
      expect(hits.map((hit) => document(hit.chunk))).toEqual(documents);
      expect(seen).toEqual([]);
      expect(consoleLog).not.toHaveBeenCalled();
    });
  });
});
