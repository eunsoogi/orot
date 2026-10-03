import { createRememoriEmbedder } from '../src/embedder';
import type { EmbeddingProvider } from '@orot/model-runtime';

describe('Rememori embedding provider adapter', () => {
  it('forwards text to Orot provider and returns float vectors', async () => {
    const provider: EmbeddingProvider = {
      kind: 'embedding',
      id: 'local-multilingual',
      displayName: 'Local multilingual model',
      capabilities: { inputTypes: ['text'] },
      async embed({ input }) {
        return { ok: true, value: { vectors: input.map(() => [3, 4]) } };
      },
    };

    const [vector] = await createRememoriEmbedder(provider).embed(['synthetic Korean input']);

    expect([...vector]).toEqual([3, 4]);
  });

  it('does not call the provider for an empty request', async () => {
    const embed = jest.fn(async () => ({ ok: true as const, value: { vectors: [] } }));
    const provider: EmbeddingProvider = {
      kind: 'embedding',
      id: 'local-multilingual',
      displayName: 'Local multilingual model',
      capabilities: { inputTypes: ['text'] },
      embed,
    };

    await expect(createRememoriEmbedder(provider).embed([])).resolves.toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it('surfaces provider failure codes without exposing provider messages', async () => {
    const provider: EmbeddingProvider = {
      kind: 'embedding',
      id: 'local-multilingual',
      displayName: 'Local multilingual model',
      capabilities: { inputTypes: ['text'] },
      async embed() {
        return {
          ok: false,
          error: { code: 'provider_unavailable', message: 'private provider detail', retryable: true },
        };
      },
    };

    await expect(createRememoriEmbedder(provider).embed(['synthetic input']))
      .rejects.toThrow('Embedding provider failed: provider_unavailable.');
  });
});
