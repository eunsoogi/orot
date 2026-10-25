import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { LOCAL_EMBEDDING_IDENTITY } from '@orot/rag';
import type { LocalEmbeddingBackend, LocalEmbeddingProgress } from '@orot/rag';
import { LocalE5Embeddings } from '../localE5Embeddings';

function unitVector(axis = 0): number[] {
  return Array.from({ length: 384 }, (_, index) => (index === axis ? 1 : 0));
}

function createBackend(
  embedBatch: LocalEmbeddingBackend['embedBatch'] = async input =>
    input.map((_, index) => unitVector(index)),
): LocalEmbeddingBackend {
  return {
    prepare: jest.fn(async (_requestId, onProgress) => onProgress(1, 1)),
    embedBatch: jest.fn(embedBatch),
    cancel: jest.fn(),
  };
}

describe('LocalE5Embeddings', () => {
  it('implements the standard interface and preserves document order and raw text', async () => {
    const backend = createBackend();
    const embeddings: EmbeddingsInterface = new LocalE5Embeddings(backend);

    await expect(
      embeddings.embedDocuments(['첫 문서', '둘째 문서']),
    ).resolves.toEqual([unitVector(0), unitVector(1)]);
    // Native E5 owns prefix insertion; adding passage: here would apply it twice.
    expect(backend.embedBatch).toHaveBeenCalledWith(
      ['첫 문서', '둘째 문서'],
      'document',
      expect.stringMatching(/^orot-embedding-/),
    );
  });

  it('returns one query vector and keeps query prefix selection in the native role', async () => {
    const backend = createBackend();
    const embeddings: EmbeddingsInterface = new LocalE5Embeddings(backend);

    await expect(embeddings.embedQuery('진료 일정')).resolves.toEqual(
      unitVector(),
    );
    expect(backend.embedBatch).toHaveBeenCalledWith(
      ['진료 일정'],
      'query',
      expect.stringMatching(/^orot-embedding-/),
    );
  });

  it('keeps the pinned model identity and returns independent mutable vectors', async () => {
    const nativeVector = Object.freeze(unitVector());
    const backend = createBackend(async () => [nativeVector]);
    const embeddings = new LocalE5Embeddings(backend);

    expect(embeddings.modelIdentity).toEqual(LOCAL_EMBEDDING_IDENTITY);
    expect(embeddings.modelIdentity).toMatchObject({
      id: 'intfloat/multilingual-e5-small',
      revision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
      dimension: 384,
    });
    const [vector] = await embeddings.embedDocuments(['문서']);
    expect(vector).toHaveLength(384);
    vector[0] = 0;
    expect(nativeVector[0]).toBe(1);
  });

  it('does not prepare the model for an empty document list', async () => {
    const backend = createBackend();
    await expect(
      new LocalE5Embeddings(backend).embedDocuments([]),
    ).resolves.toEqual([]);
    expect(backend.prepare).not.toHaveBeenCalled();
    expect(backend.embedBatch).not.toHaveBeenCalled();
  });

  it('preserves bounded document batches and both progress stages', async () => {
    const backend = createBackend();
    const progress: LocalEmbeddingProgress[] = [];
    const embeddings = new LocalE5Embeddings(backend);

    const vectors = await embeddings.embedDocuments(['하나', '둘', '셋'], {
      batchSize: 2,
      onProgress: event => progress.push(event),
    });

    expect(vectors).toHaveLength(3);
    expect(backend.prepare).toHaveBeenCalledTimes(1);
    const requestId = (backend.prepare as jest.Mock).mock.calls[0][0];
    expect(backend.embedBatch).toHaveBeenNthCalledWith(
      1,
      ['하나', '둘'],
      'document',
      requestId,
    );
    expect(backend.embedBatch).toHaveBeenNthCalledWith(
      2,
      ['셋'],
      'document',
      requestId,
    );
    expect(progress).toEqual([
      { stage: 'model_download', completed: 1, total: 1 },
      { stage: 'embedding', role: 'document', completed: 2, total: 3 },
      { stage: 'embedding', role: 'document', completed: 3, total: 3 },
    ]);
  });

  it('reports query progress through the optional per-job controls', async () => {
    const onProgress = jest.fn();
    await new LocalE5Embeddings(createBackend()).embedQuery('질문', {
      onProgress,
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      stage: 'embedding',
      role: 'query',
      completed: 1,
      total: 1,
    });
  });

  it.each([
    ['wrong dimensions', [1]],
    ['non-finite values', unitVector().map(() => Number.NaN)],
    ['non-unit vectors', unitVector().map(value => value * 2)],
  ])('rejects %s rather than exposing invalid vectors', async (_name, vector) => {
    const backend = createBackend(async () => [vector as number[]]);
    await expect(
      new LocalE5Embeddings(backend).embedQuery('질문'),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('rejects incomplete native batches', async () => {
    const backend = createBackend(async () => [unitVector()]);
    await expect(
      new LocalE5Embeddings(backend).embedDocuments(['하나', '둘']),
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true });
  });

  it('rejects invalid input and batch sizes before native preparation', async () => {
    const backend = createBackend();
    const embeddings = new LocalE5Embeddings(backend);
    await expect(embeddings.embedQuery('  ')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(
      embeddings.embedDocuments(['문서'], { batchSize: 9 }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(backend.prepare).not.toHaveBeenCalled();
  });

  it('propagates unavailable native runtime errors as retryable failures', async () => {
    const backend = createBackend(async () => {
      throw new Error('Native runtime unavailable.');
    });
    await expect(
      new LocalE5Embeddings(backend).embedQuery('질문'),
    ).rejects.toMatchObject({
      code: 'provider_unavailable',
      message: 'Native runtime unavailable.',
      retryable: true,
    });
  });

  it('rejects an already-cancelled query before starting native work', async () => {
    const backend = createBackend();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new LocalE5Embeddings(backend).embedQuery('질문', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(backend.prepare).not.toHaveBeenCalled();
    expect(backend.cancel).not.toHaveBeenCalled();
  });

  it('cancels the active native job and prevents its remaining batches', async () => {
    const controller = new AbortController();
    let finishBatch!: (vectors: number[][]) => void;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const backend = createBackend(
      () =>
        new Promise(resolve => {
          finishBatch = resolve;
          markStarted();
        }),
    );
    const embeddings = new LocalE5Embeddings(backend);
    const onProgress = jest.fn();
    const pending = embeddings.embedDocuments(['하나', '둘'], {
      batchSize: 1,
      signal: controller.signal,
      onProgress,
    });
    // Wait for a real batch boundary so abort does not depend on a timer or sleep.
    await started;
    const requestId = (backend.embedBatch as jest.Mock).mock.calls[0][2];
    controller.abort();
    expect(backend.cancel).toHaveBeenCalledWith(requestId);
    finishBatch([unitVector()]);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(backend.embedBatch).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('removes the abort listener once a successful job settles', async () => {
    const backend = createBackend();
    const controller = new AbortController();
    await new LocalE5Embeddings(backend).embedQuery('질문', {
      signal: controller.signal,
    });
    controller.abort();
    expect(backend.cancel).not.toHaveBeenCalled();
  });
});
