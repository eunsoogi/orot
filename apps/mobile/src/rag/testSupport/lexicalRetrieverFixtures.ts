import type { EvidenceChunk, LocalFullTextSearchStore } from '@orot/rag';
import { LocalLexicalRetriever } from '../localLexicalRetriever';
import type { LocalLexicalRetrieverInput } from '../localLexicalRetriever';

/** Synthetic evidence with explicit local row and citation identities. */
export function lexicalChunk(id: string): EvidenceChunk {
  return {
    id,
    text: '합성 진료 기록 ' + id,
    metadata: {
      sourceId: 'source-' + id,
      sourceRecordIds: ['source-' + id],
      evidenceId: 'record-' + id,
      evidenceLocator: { kind: 'structured_record', recordId: 'record-' + id },
      effectiveTime: '2026-10-25T09:00:00+09:00',
      recordType: 'encounter',
      reviewState: { status: 'unreviewed' },
      encounterId: 'encounter-' + id,
    },
  };
}

export function lexicalSetup(
  overrides: Partial<LocalLexicalRetrieverInput> = {},
) {
  const chunks = [lexicalChunk('first'), lexicalChunk('second')];
  const textStore: LocalFullTextSearchStore = {
    search: jest.fn(
      async (_query: string, page: readonly EvidenceChunk[], limit: number) =>
        page.slice(0, limit).map(chunk => ({ chunkId: chunk.id })),
    ),
  };
  const removalReader = {
    findRemovedEvidence: jest.fn(async () => ({
      sourceRecordIds: [] as string[],
      chunkIds: [] as string[],
    })),
  };
  const input = { chunks, textStore, removalReader, ...overrides };
  return {
    chunks,
    textStore,
    removalReader,
    retriever: new LocalLexicalRetriever(input),
  };
}
