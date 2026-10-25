import { Document } from '@langchain/core/documents';
import type { EvidenceChunk, EvidenceChunkMetadata } from '../chunking';

/** Copy JSON-shaped evidence metadata without dropping absent, undefined, or extension fields. */
function copyMetadataValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyMetadataValue) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, copyMetadataValue(item)]),
    ) as T;
  }
  return value;
}

/**
 * Conversion keeps the persisted chunk identity and citation metadata intact.
 * Deleted/stale extension markers remain opaque; source eligibility still belongs
 * to the existing retrieval boundary, rather than this representation adapter.
 */
export function evidenceChunkToDocument<Metadata extends EvidenceChunkMetadata>(
  chunk: EvidenceChunk & { readonly metadata: Metadata },
): Document<Metadata> {
  return new Document({
    id: chunk.id,
    pageContent: chunk.text,
    metadata: copyMetadataValue(chunk.metadata),
  });
}

/** Restore a typed evidence document without synthesizing a new source or chunk identity. */
export function documentToEvidenceChunk<Metadata extends EvidenceChunkMetadata>(
  document: Document<Metadata>,
): EvidenceChunk & { readonly metadata: Metadata } {
  // LangChain allows an absent ID, but inventing one would break persisted citations.
  if (document.id === undefined) {
    throw new Error('An evidence document must retain its chunk ID.');
  }
  return {
    id: document.id,
    text: document.pageContent,
    metadata: copyMetadataValue(document.metadata),
  };
}
