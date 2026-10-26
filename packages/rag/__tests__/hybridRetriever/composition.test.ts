import { Document } from '@langchain/core/documents';
import {
  chunk,
  document,
  setup,
  StockRetriever,
  PrivateFieldRetriever,
  consume,
  withPrivateCallbackContext,
} from './fixtures';

describe('standard hybrid retriever composition', () => {
  it('preserves a direct adapter with native private fields', async () => {
    const page = [chunk('private-field')];
    const { retriever } = setup(page, [], [], {
      createLexicalRetriever: () => new PrivateFieldRetriever(page.map(document)),
    });
    expect(await retriever.invoke('synthetic query')).toEqual(page.map(document));
  });

  it.each(['invoke', 'batch', 'events', 'log'])(
    'rejects reuse before a second child invocation through %s',
    async (method) => {
      const page = [chunk('owned-instance')];
      const child = new StockRetriever(page.map(document));
      const invoke = jest.spyOn(child, 'invoke');
      const { retriever } = setup(page, [], [], { createLexicalRetriever: () => child });
      expect(await retriever.invoke('synthetic first query')).toEqual(page.map(document));
      await expect(consume(retriever, method, 'synthetic reuse query')).rejects.toThrow(
        'fresh single-use',
      );
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps synthetic callback payloads private at the hybrid and standard child boundaries', async () => {
    await withPrivateCallbackContext(async (seen, handler, consoleLog) => {
      const query = 'synthetic private query';
      const page = [chunk('private')];
      const documents = page.map(document);
      const stock = new StockRetriever(documents, { verbose: true });
      expect(await stock.invoke(query)).toEqual(documents);
      expect(seen).toEqual([query, documents]);
      expect(consoleLog.mock.calls.flat().join(' ')).toContain(query);
      expect(consoleLog.mock.calls.flat().join(' ')).toContain(page[0].text);
      seen.length = 0;
      consoleLog.mockClear();
      const { retriever } = setup(page, [], [], {
        callbacks: [handler],
        verbose: true,
        createLexicalRetriever: () =>
          new StockRetriever(documents, { callbacks: [handler], verbose: true }),
        createVectorRetriever: () =>
          new StockRetriever(documents, { callbacks: [handler], verbose: true }),
      });
      expect(await retriever.invoke(query, { callbacks: [handler] })).toEqual(documents);
      expect(seen).toEqual([]);
      expect(consoleLog).not.toHaveBeenCalled();
      expect(await retriever.batch([query], [{ callbacks: [handler] }])).toEqual([documents]);
      const stream = await retriever.stream(query, { callbacks: [handler] });
      const streamed = [];
      for await (const output of stream) streamed.push(output);
      expect(streamed).toEqual([documents]);
      for (const version of ['v1', 'v2'] as const) {
        const events = [];
        for await (const event of retriever.streamEvents(query, { version, callbacks: [handler] }))
          events.push(event);
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ event: 'on_retriever_start', data: { input: query } }),
            expect.objectContaining({
              event: 'on_retriever_end',
              data: {
                output: version === 'v2' ? documents : { documents },
              },
            }),
          ]),
        );
      }
      expect(seen).toEqual([]);
      const failure = new Error('synthetic private failure');
      const failed = setup(page, [], [], {
        callbacks: [handler],
        createLexicalRetriever: () => new StockRetriever([], { callbacks: [handler] }, failure),
      }).retriever;
      await expect(failed.invoke(query, { callbacks: [handler] })).rejects.toThrow(failure);
      expect(seen).toEqual([]);
    });
  });

  it('preserves cancellation and the signal passed to each child without disclosing callbacks', async () => {
    await withPrivateCallbackContext(async (seen, handler) => {
      const controller = new AbortController();
      const page = [chunk('a')];
      const { retriever, lexicalInvoke, vectorInvoke } = setup(page, page.map(document), [], {
        callbacks: [handler],
      });
      lexicalInvoke.mockImplementation(async () => {
        controller.abort();
        return page.map(document);
      });
      await expect(
        retriever.invoke('synthetic query', { signal: controller.signal, callbacks: [handler] }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      for (const invoke of [lexicalInvoke, vectorInvoke]) {
        expect(invoke).toHaveBeenCalledWith(
          'synthetic query',
          expect.objectContaining({ signal: controller.signal }),
        );
      }
      expect(seen).toEqual([]);
    });
  });

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

  it('isolates simultaneous cancellation and normalizes a live caller deadline once', async () => {
    const page = [chunk('a')];
    const controller = new AbortController();
    const { retriever, lexicalInvoke, vectorInvoke } = setup(page, page.map(document), []);
    lexicalInvoke.mockImplementation(async (query: string) => {
      if (query === 'synthetic cancelled query') controller.abort();
      return page.map(document);
    });
    const [cancelled, live] = await Promise.allSettled([
      retriever.invoke('synthetic cancelled query', { signal: controller.signal }),
      retriever.invoke('synthetic live query', { timeout: 1000 }),
    ]);
    expect(cancelled).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } });
    expect(live).toMatchObject({ status: 'fulfilled', value: page.map(document) });
    for (const invoke of [lexicalInvoke, vectorInvoke]) {
      const config = (
        invoke.mock.calls as unknown as [
          string,
          { signal: AbortSignal; timeout?: number; metadata: { timeoutMs: number } },
        ][]
      ).find(([query]) => query === 'synthetic live query')![1];
      expect(config.signal).toBeInstanceOf(AbortSignal);
      expect(config.signal.aborted).toBe(false);
      expect(config.timeout).toBeUndefined();
      expect(config.metadata.timeoutMs).toBe(1000);
    }
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

  it('validates search requests while accepting larger caller-selected pages', async () => {
    const page = [chunk('a')];
    for (const limit of [0, 501, NaN, 1.5]) expect(() => setup(page, [], [], { limit })).toThrow();
    expect(() => setup(page, [], [], { ranking: { lexicalWeight: 0, vectorWeight: 0 } })).toThrow();
    const largePage = Array.from({ length: 501 }, (_, i) => chunk(String(i)));
    const large = setup(largePage, [document(largePage[500])], [document(largePage[0])], {
      limit: 2,
    });
    expect(await large.retriever.invoke('query')).toEqual([
      document(largePage[0]),
      document(largePage[500]),
    ]);
    expect((await large.retriever.searchHits('query')).map((hit) => hit.chunk)).toEqual([
      largePage[0],
      largePage[500],
    ]);
    expect(large.input.createLexicalRetriever).toHaveBeenCalledTimes(2);
    expect(large.input.createVectorRetriever).toHaveBeenCalledTimes(2);
    const { retriever } = setup(page, [], [], { filters: { timeRange: { start: 'invalid' } } });
    await expect(retriever.invoke('query')).rejects.toThrow();
    await expect(setup([page[0], page[0]], [], []).retriever.invoke('query')).rejects.toThrow();
  });
});
