import type { DocumentInterface } from '@langchain/core/documents';
import {
  documentToEvidenceChunk,
  type EvidenceChunk,
  type EvidenceChunkMetadata,
  type LocalEmbeddingVectorStore,
} from '@orot/rag';

export const MAX_VECTOR_CANDIDATES = 500;

/** Reject incomplete standard documents instead of inventing citation identities. */
export function vectorStoreChunks(
  documents: DocumentInterface[],
): EvidenceChunk[] {
  const chunks = documents.map(document => {
    const metadata = document.metadata as EvidenceChunkMetadata;
    if (
      !document.id?.trim() ||
      !document.pageContent?.trim() ||
      !metadata.sourceId?.trim() ||
      !metadata.evidenceId?.trim() ||
      !Array.isArray(metadata.sourceRecordIds) ||
      metadata.sourceRecordIds.some(
        id => typeof id !== 'string' || !id.trim(),
      ) ||
      !metadata.evidenceLocator?.kind ||
      !metadata.reviewState?.status ||
      !metadata.recordType
    )
      throw new Error(
        'Vector documents need complete evidence metadata and stable IDs.',
      );
    return documentToEvidenceChunk({ ...document, metadata });
  });
  if (new Set(chunks.map(chunk => chunk.id)).size !== chunks.length) {
    throw new Error('Vector documents need unique chunk IDs.');
  }
  return chunks;
}

/** Include structured row IDs separately from external HealthKit provenance keys. */
export function evidenceIdentities(chunk: EvidenceChunk): string[] {
  const locator = chunk.metadata.evidenceLocator;
  return [
    ...new Set([
      chunk.metadata.sourceId,
      ...chunk.metadata.sourceRecordIds,
      ...(locator.kind === 'structured_record' &&
      locator.recordId === chunk.metadata.evidenceId
        ? [locator.recordId]
        : []),
    ]),
  ];
}

/** Match the hybrid retriever's durable fences and missing-source rules before scoring. */
export async function eligibleVectorChunks(
  chunks: readonly EvidenceChunk[],
  storage: LocalEmbeddingVectorStore,
): Promise<EvidenceChunk[]> {
  const removed = await storage.findRemovedEvidence(
    [...new Set(chunks.flatMap(evidenceIdentities))],
    chunks.map(chunk => chunk.id),
    chunks
      .filter(
        chunk =>
          chunk.metadata.evidenceLocator.kind !== 'structured_record' &&
          chunk.metadata.sourceRecordIds.includes(chunk.metadata.sourceId),
      )
      .map(chunk => chunk.metadata.sourceId),
    chunks.flatMap(chunk => {
      const locator = chunk.metadata.evidenceLocator;
      return locator.kind === 'structured_record' &&
        locator.recordId === chunk.metadata.evidenceId
        ? [locator.recordId]
        : [];
    }),
  );
  const sources = new Set(removed.sourceRecordIds);
  const ids = new Set(removed.chunkIds);
  return chunks.filter(
    chunk =>
      !ids.has(chunk.id) &&
      !evidenceIdentities(chunk).some(id => sources.has(id)),
  );
}
