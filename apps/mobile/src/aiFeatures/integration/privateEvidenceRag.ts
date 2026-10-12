import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

/** Keeps database deletion guards on real identities, then restores turn-local aliases for responders. */
export function createPrivateEvidenceRag(
  rag: AiFeatureLocalData['rag'],
  registry: LocalEvidenceReferenceRegistry,
): AiFeatureLocalData['rag'] {
  return {
    index: (chunks, options) =>
      rag.index(
        chunks.map(chunk => registry.localSearchChunk(chunk)),
        options,
      ),
    async search(query, chunks, limit, options) {
      const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
      const hits = await rag.search(
        query,
        chunks.map(chunk => registry.localSearchChunk(chunk)),
        limit,
        options,
      );
      return hits.flatMap(hit => {
        const chunk = byId.get(hit.chunk.id);
        return chunk ? [{ ...hit, chunk }] : [];
      });
    },
  };
}
