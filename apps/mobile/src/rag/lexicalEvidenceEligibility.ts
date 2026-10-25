import type { EvidenceChunk, LocalEmbeddingVectorStore } from '@orot/rag';

export type EvidenceRemovalReader = Pick<
  LocalEmbeddingVectorStore,
  'findRemovedEvidence'
>;

/** Apply the existing persisted deletion fence to a caller-owned candidate page. */
export async function eligibleLexicalEvidence(
  chunks: readonly EvidenceChunk[],
  reader: EvidenceRemovalReader,
): Promise<EvidenceChunk[]> {
  const identities = new Map(
    chunks.map(chunk => {
      const locator = chunk.metadata.evidenceLocator;
      return [
        chunk.id,
        [
          chunk.metadata.sourceId,
          ...chunk.metadata.sourceRecordIds,
          ...(locator.kind === 'structured_record' &&
          locator.recordId === chunk.metadata.evidenceId
            ? [locator.recordId]
            : []),
        ],
      ] as const;
    }),
  );
  // External provenance IDs are not source_records rows. Only explicit roots
  // and structured local row identities participate in missing-row checks.
  const roots = chunks
    .filter(
      chunk =>
        chunk.metadata.evidenceLocator.kind !== 'structured_record' &&
        chunk.metadata.sourceRecordIds.includes(chunk.metadata.sourceId),
    )
    .map(chunk => chunk.metadata.sourceId);
  const localRecords = chunks.flatMap(chunk => {
    const locator = chunk.metadata.evidenceLocator;
    return locator.kind === 'structured_record' &&
      locator.recordId === chunk.metadata.evidenceId
      ? [locator.recordId]
      : [];
  });
  const removed = await reader.findRemovedEvidence(
    [...new Set([...identities.values()].flat())],
    chunks.map(chunk => chunk.id),
    [...new Set(roots)],
    [...new Set(localRecords)],
  );
  const sources = new Set(removed.sourceRecordIds);
  const ids = new Set(removed.chunkIds);
  return chunks.filter(
    chunk =>
      !ids.has(chunk.id) &&
      !identities.get(chunk.id)!.some(sourceId => sources.has(sourceId)),
  );
}
