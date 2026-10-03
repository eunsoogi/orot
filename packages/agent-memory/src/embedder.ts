import type { EmbeddingProvider } from '@orot/model-runtime';
import type { Embedder } from 'rememori';

/** Adapts Orot's selected local embedding provider without adding a provider. */
export function createRememoriEmbedder(provider: EmbeddingProvider): Embedder {
  return {
    async embed(texts) {
      if (texts.length === 0) return [];
      const result = await provider.embed({ input: texts });
      if (!result.ok) throw new Error(`Embedding provider failed: ${result.error.code}.`);
      if (result.value.vectors.length !== texts.length) {
        throw new Error('Embedding provider returned a different number of vectors than requested.');
      }
      return result.value.vectors.map(vector => {
        if (vector.length === 0 || vector.some(value => !Number.isFinite(value))) {
          throw new Error('Embedding provider returned an invalid vector.');
        }
        return Float32Array.from(vector);
      });
    },
  };
}
