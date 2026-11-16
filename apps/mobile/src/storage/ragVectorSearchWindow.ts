import type { EvidenceChunk } from '@orot/rag';
import { evidenceChunkToDocument } from '@orot/rag';
import type { DocumentInterface } from '@langchain/core/documents';
import { vectorDocumentFingerprint } from './ragVectorStoreRevision';
import { vectorSimilarity } from './sqlCipherVectorStoreSupport';

export interface VectorSearchSnapshot {
  readonly candidates: readonly EvidenceChunk[];
  readonly vectors: ReadonlyMap<string, readonly number[]>;
  readonly revisions: ReadonlyMap<string, string>;
}

/** Hashing may cross a slow native bridge; never hold the shared SQL transaction across it. */
export async function searchVectorSnapshot(
  query: readonly number[],
  read: () => Promise<VectorSearchSnapshot>,
): Promise<[DocumentInterface, number][]> {
  const first = await read();
  const verified: {
    chunk: EvidenceChunk;
    fingerprint: string;
    score: number;
  }[] = [];
  for (const chunk of first.candidates) {
    const vector = first.vectors.get(chunk.id);
    if (!vector) continue;
    const fingerprint = await vectorDocumentFingerprint(chunk, vector);
    if (first.revisions.get(chunk.id) !== fingerprint) continue;
    const score = vectorSimilarity(query, vector);
    if (Number.isFinite(score)) verified.push({ chunk, fingerprint, score });
  }
  if (!verified.length) return [];
  // Reacquire one atomic read fence after all native work. Deletions, revision updates and
  // legacy blob-only replacements during hashing must invalidate the earlier snapshot.
  const current = await read();
  const eligible = new Set(current.candidates.map(chunk => chunk.id));
  return verified.flatMap(({ chunk, fingerprint, score }) => {
    const before = first.vectors.get(chunk.id)!;
    const after = current.vectors.get(chunk.id);
    if (
      !eligible.has(chunk.id) ||
      current.revisions.get(chunk.id) !== fingerprint ||
      !after ||
      after.length !== before.length ||
      after.some((value, index) => value !== before[index])
    )
      return [];
    return [
      [evidenceChunkToDocument(chunk), score] as [DocumentInterface, number],
    ];
  });
}
