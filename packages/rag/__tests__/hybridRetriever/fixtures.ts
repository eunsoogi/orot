import type { DocumentInterface } from '@langchain/core/documents';
import type { EvidenceChunk } from '../../src/chunking';
import { evidenceChunkToDocument } from '../../src/langchain/documents';
import { HybridRetriever, type HybridRetrieverInput } from '../../src/hybridRetriever';

/** Synthetic citation identities keep rank and freshness tests independent of personal records. */
export function chunk(id: string): EvidenceChunk {
  return {
    id,
    text: 'Synthetic consultation ' + id,
    metadata: {
      sourceId: 'source-' + id,
      sourceRecordIds: ['source-' + id],
      evidenceId: 'record-' + id,
      evidenceLocator: { kind: 'text_range', startOffset: 0, endOffset: 12 },
      effectiveTime: '2026-10-01T10:00:00Z',
      recordType: 'transcript_segment',
      reviewState: { status: 'unreviewed' },
      encounterId: 'encounter-a',
    },
  };
}

export const document = evidenceChunkToDocument;

export function setup(
  chunks: EvidenceChunk[],
  lexical: DocumentInterface[],
  vector: DocumentInterface[],
  overrides: Partial<HybridRetrieverInput> = {},
) {
  const lexicalInvoke = jest.fn(async () => lexical);
  const vectorInvoke = jest.fn(async () => vector);
  const removalReader = {
    findRemovedEvidence: jest.fn(async () => ({
      sourceRecordIds: [] as string[],
      chunkIds: [] as string[],
    })),
  };
  const input = {
    chunks,
    removalReader,
    createLexicalRetriever: jest.fn(() => ({ invoke: lexicalInvoke })),
    createVectorRetriever: jest.fn(() => ({ invoke: vectorInvoke })),
    ...overrides,
  };
  return {
    retriever: new HybridRetriever(input),
    input,
    lexicalInvoke,
    vectorInvoke,
    removalReader,
  };
}
