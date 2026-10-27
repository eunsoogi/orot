import { HybridRetriever } from '@orot/rag';
import type { EvidenceChunk } from '@orot/rag';

const {
  createSyntheticRag,
} = require('../../../scripts/evaluation/visit-questions/synthetic-rag.cjs');
const {
  SyntheticVectorStore,
} = require('../../../scripts/evaluation/visit-questions/synthetic-retrievers.cjs');

const chunk: EvidenceChunk = {
  id: 'synthetic-evidence',
  text: 'synthetic appointment next visit',
  metadata: {
    sourceId: 'synthetic-source',
    sourceRecordIds: ['synthetic-source'],
    evidenceId: 'synthetic-evidence',
    recordType: 'evidence_span',
    evidenceLocator: { kind: 'text_range', startOffset: 0, endOffset: 36 },
    effectiveTime: null,
    reviewState: { status: 'unreviewed' },
  },
};

it('executes standard evaluation adapters and preserves ranks, citations, correction eligibility and deletion fences', async () => {
  let sourcePresent = true;
  const repository = { get: async () => (sourcePresent ? { id: 'synthetic-source' } : null) };
  const trace = { ragIndexCalls: 0, ragSearchCalls: 0 };
  const index = jest.spyOn(SyntheticVectorStore.prototype, 'addDocuments');
  const retrieve = jest.spyOn(HybridRetriever.prototype, 'searchHits');
  try {
    const rag = createSyntheticRag(repository, trace);
    await rag.index([chunk]);
    const hits = await rag.search('appointment', [chunk], 1);
    expect(hits).toEqual([{ chunk, lexicalRank: 1, vectorRank: 1, score: 1 / 61 }]);
    expect(index).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledTimes(1);
    const corrected = { ...chunk, text: 'corrected current evidence' };
    expect(await rag.search('appointment', [corrected], 1)).toEqual([]);
    await rag.index([corrected]);
    expect(await rag.search('corrected', [corrected], 1)).toMatchObject([
      { chunk: corrected, lexicalRank: 1, vectorRank: 1 },
    ]);
    sourcePresent = false;
    expect(await rag.search('corrected', [corrected], 1)).toEqual([]);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      rag.search('corrected', [corrected], 1, { signal: cancelled.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    jest.restoreAllMocks();
  }
});
