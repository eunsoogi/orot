import { BaseRetriever } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import type { EvidenceSearchFilters } from '@orot/rag';
import {
  lexicalChunk,
  lexicalSetup,
} from '../testSupport/lexicalRetrieverFixtures';

describe('LocalLexicalRetriever', () => {
  it('supports standard invoke and pipe while preserving lexical order and metadata', async () => {
    const { retriever, chunks, textStore } = lexicalSetup();
    expect(retriever).toBeInstanceOf(BaseRetriever);
    (textStore.search as jest.Mock).mockResolvedValue([
      { chunkId: chunks[1].id },
      { chunkId: chunks[0].id },
    ]);
    const documents = await retriever.invoke('진료');
    expect(documents).toEqual(
      [chunks[1], chunks[0]].map(
        chunk =>
          new Document({
            id: chunk.id,
            pageContent: chunk.text,
            metadata: chunk.metadata,
          }),
      ),
    );
    expect(documents[0].metadata).not.toBe(chunks[1].metadata);
    expect(documents[0].metadata.evidenceLocator).not.toBe(
      chunks[1].metadata.evidenceLocator,
    );
    await expect(
      retriever.pipe(docs => docs.map(doc => doc.id)).invoke('진료'),
    ).resolves.toEqual(['second', 'first']);
  });

  it('keeps transcript revision and extension metadata independent of the candidate', async () => {
    const chunk = lexicalChunk('transcript');
    const metadata = {
      ...chunk.metadata,
      transcriptRevision: {
        transcriptId: 'transcript',
        segmentOrdinal: 2,
        revision: 3,
        supersedesId: 'revision-2',
      },
      extension: { values: ['retained'] },
    };
    const { retriever } = lexicalSetup({ chunks: [{ ...chunk, metadata }] });
    const [document] = await retriever.invoke('진료');
    expect(document.metadata).toEqual(metadata);
    expect(document.metadata.transcriptRevision).not.toBe(
      metadata.transcriptRevision,
    );
    expect(document.metadata).not.toBe(metadata);
  });

  it('bounds the store candidate count and result count without expanding the page', async () => {
    const { retriever, chunks, textStore } = lexicalSetup({
      limit: 1,
      candidateLimit: 2,
    });
    await expect(retriever.invoke('진료')).resolves.toHaveLength(1);
    expect(textStore.search).toHaveBeenCalledWith('진료', chunks, 2, undefined);
    const expanded = lexicalSetup({ limit: 3, candidateLimit: 1 });
    await expanded.retriever.invoke('진료');
    expect(expanded.textStore.search).toHaveBeenCalledWith(
      '진료',
      expanded.chunks,
      3,
      undefined,
    );
  });

  it('ignores unknown and duplicate IDs and never consumes matches beyond the candidate budget', async () => {
    const { retriever, textStore } = lexicalSetup({
      candidateLimit: 5,
      limit: 1,
    });
    (textStore.search as jest.Mock).mockResolvedValue([
      { chunkId: 'outside-page' },
      { chunkId: 'second' },
      { chunkId: 'second' },
      { chunkId: 'first' },
    ]);
    await expect(retriever.invoke('진료')).resolves.toMatchObject([
      { id: 'second' },
    ]);
    const bounded = lexicalSetup({ limit: 2, candidateLimit: 2 });
    (bounded.textStore.search as jest.Mock).mockResolvedValue([
      { chunkId: 'second' },
      { chunkId: 'second' },
      { chunkId: 'first' },
    ]);
    await expect(bounded.retriever.invoke('진료')).resolves.toMatchObject([
      { id: 'second' },
    ]);
  });

  it.each<[string, EvidenceSearchFilters]>([
    [
      'time',
      {
        timeRange: {
          start: '2026-10-25T00:00:00Z',
          end: '2026-10-25T00:00:00Z',
        },
      },
    ],
    ['type', { recordTypes: ['encounter'] }],
    ['encounter', { encounterId: 'encounter-first' }],
    ['review', { reviewStates: ['unreviewed'] }],
  ])(
    'applies the %s filter before lexical candidate selection',
    async (_name, filters) => {
      const first = lexicalChunk('first');
      const second = lexicalChunk('second');
      const excluded = {
        ...second,
        metadata: {
          ...second.metadata,
          effectiveTime: null,
          recordType: 'symptom_entry' as const,
          reviewState: {
            status: 'needs_review' as const,
            reason: 'Synthetic review',
          },
        },
      };
      const { retriever, textStore } = lexicalSetup({
        chunks: [first, excluded],
        filters,
      });
      await expect(retriever.invoke('진료')).resolves.toMatchObject([
        { id: first.id },
      ]);
      expect(textStore.search).toHaveBeenCalledWith(
        '진료',
        [first],
        20,
        undefined,
      );
    },
  );

  it.each([0, -1, 501, 1.5, Number.NaN])(
    'rejects invalid result count %s',
    limit => {
      expect(() => lexicalSetup({ limit })).toThrow();
      expect(() => lexicalSetup({ candidateLimit: limit })).toThrow();
    },
  );

  it('rejects invalid filters and duplicate or blank candidates before storage work', async () => {
    for (const input of [
      { chunks: [lexicalChunk('same'), lexicalChunk('same')] },
      { chunks: [{ ...lexicalChunk('blank'), text: ' ' }] },
      { filters: { timeRange: { start: 'no-offset' } } },
    ]) {
      const setup = lexicalSetup(input);
      await expect(setup.retriever.invoke('진료')).rejects.toMatchObject({
        code: 'invalid_request',
      });
      expect(setup.textStore.search).not.toHaveBeenCalled();
      expect(setup.removalReader.findRemovedEvidence).not.toHaveBeenCalled();
    }
  });

  it('does no storage work for blank queries or empty filtered pages', async () => {
    const cases = [
      { setup: lexicalSetup(), query: ' ' },
      { setup: lexicalSetup({ chunks: [] }), query: '진료' },
      { setup: lexicalSetup({ filters: { recordTypes: [] } }), query: '진료' },
    ];
    for (const { setup, query } of cases) {
      await expect(setup.retriever.invoke(query)).resolves.toEqual([]);
      expect(setup.textStore.search).not.toHaveBeenCalled();
      expect(setup.removalReader.findRemovedEvidence).not.toHaveBeenCalled();
    }
  });

  it('propagates store errors through standard retriever error callbacks', async () => {
    const { retriever, textStore } = lexicalSetup();
    const failure = new Error('FTS unavailable');
    (textStore.search as jest.Mock).mockRejectedValue(failure);
    const handleRetrieverError = jest.fn();
    await expect(
      retriever.invoke('진료', {
        callbacks: [{ handleRetrieverError }],
      }),
    ).rejects.toBe(failure);
    expect(handleRetrieverError).toHaveBeenCalledTimes(1);
    expect(handleRetrieverError.mock.calls[0][0]).toBe(failure);
  });

  it('rejects an aborted invocation before reading evidence', async () => {
    const setup = lexicalSetup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      setup.retriever.invoke('진료', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(setup.removalReader.findRemovedEvidence).not.toHaveBeenCalled();
    expect(setup.textStore.search).not.toHaveBeenCalled();
  });
});
