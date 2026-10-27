import type { EmbeddingProvider } from '@orot/model-runtime';
import { LocalE5EmbeddingProvider } from '../localE5EmbeddingProvider';
import type { LocalEmbeddingBackend, LocalEmbeddingRole } from '@orot/rag';

function unitVector(): number[] {
  return Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));
}

function createBackend(embedBatch?: LocalEmbeddingBackend['embedBatch']) {
  const roles: LocalEmbeddingRole[] = [];
  const backend: LocalEmbeddingBackend = {
    prepare: jest.fn(async (_requestId, onProgress) => onProgress(1, 1)),
    embedBatch:
      embedBatch ??
      jest.fn(async (input, role) => {
        roles.push(role);
        return input.map(unitVector);
      }),
    cancel: jest.fn(),
  };
  return { backend, roles };
}

describe('LocalE5EmbeddingProvider', () => {
  it('implements the provider-neutral API for ordinary document embeddings', async () => {
    const { backend } = createBackend();
    const provider: EmbeddingProvider = new LocalE5EmbeddingProvider(backend);

    const result = await provider.embed({ input: ['외래 일정'] });

    expect(result).toEqual({ ok: true, value: { vectors: [unitVector()] } });
    expect(backend.embedBatch).toHaveBeenCalledWith(
      ['외래 일정'],
      'document',
      expect.stringMatching(/^orot-embedding-/),
    );
  });

  it.each(['not-an-array', null, ['']])(
    'rejects malformed embedding input before native inference: %p',
    async input => {
      const { backend } = createBackend();
      const provider = new LocalE5EmbeddingProvider(backend);
      await expect(
        provider.embed({ input: input as never }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid_request', retryable: false },
      });
      expect(backend.prepare).not.toHaveBeenCalled();
      expect(backend.embedBatch).not.toHaveBeenCalled();
    },
  );

  it('returns a retryable provider error when the native runtime is unavailable', async () => {
    const { backend } = createBackend(async () => {
      throw new Error('CoreML session unavailable.');
    });
    const provider = new LocalE5EmbeddingProvider(backend);

    await expect(provider.embed({ input: ['질문'] })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'provider_unavailable',
        message: 'CoreML session unavailable.',
        retryable: true,
      },
    });
  });
});
