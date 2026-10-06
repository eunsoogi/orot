import { LocalEmbeddingJobError, runLocalEmbeddingJob } from '../src/localEmbeddings';
import type { LocalEmbeddingBackend } from '../src/localEmbeddings';

function unitVector(first = 1): number[] {
  const vector = Array.from({ length: 384 }, () => 0);
  vector[0] = first;
  return vector;
}

function createBackend(
  embedBatch: LocalEmbeddingBackend['embedBatch'] = async (texts) => texts.map(() => unitVector()),
): LocalEmbeddingBackend {
  return {
    prepare: jest.fn(async () => undefined),
    embedBatch: jest.fn(embedBatch),
    cancel: jest.fn(),
  };
}

describe('local E5 embedding jobs', () => {
  it('prepares once, sends bounded document batches, and reports completed vectors', async () => {
    const backend = createBackend();
    const progress: { stage: string; completed: number; total: number }[] = [];

    const result = await runLocalEmbeddingJob(
      backend,
      ['기록 하나', '기록 둘', '기록 셋', '기록 넷', '기록 다섯'],
      'document',
      { batchSize: 2, onProgress: (value) => progress.push(value) },
    );

    expect(backend.prepare).toHaveBeenCalledTimes(1);
    expect(backend.embedBatch).toHaveBeenNthCalledWith(
      1,
      ['기록 하나', '기록 둘'],
      'document',
      expect.any(String),
    );
    expect(backend.embedBatch).toHaveBeenCalledTimes(3);
    expect(result.vectors).toHaveLength(5);
    expect(progress.filter((item) => item.stage === 'embedding')).toEqual([
      { stage: 'embedding', role: 'document', completed: 2, total: 5 },
      { stage: 'embedding', role: 'document', completed: 4, total: 5 },
      { stage: 'embedding', role: 'document', completed: 5, total: 5 },
    ]);
  });

  it('does not load the model for an empty request and rejects non-unit vectors', async () => {
    const backend = createBackend(async (texts) => texts.map(() => unitVector(2)));
    await expect(runLocalEmbeddingJob(backend, [], 'query')).resolves.toEqual({ vectors: [] });
    expect(backend.prepare).not.toHaveBeenCalled();

    await expect(runLocalEmbeddingJob(backend, ['질문'], 'query')).rejects.toMatchObject({
      name: 'LocalEmbeddingJobError',
      code: 'provider_unavailable',
    });
  });

  it('cancels the active native request and does not start the next batch', async () => {
    const controller = new AbortController();
    let finishBatch: ((vectors: readonly (readonly number[])[]) => void) | undefined;
    const backend = createBackend(
      () =>
        new Promise((resolve) => {
          finishBatch = resolve;
        }),
    );
    const run = runLocalEmbeddingJob(backend, ['첫째', '둘째'], 'query', {
      batchSize: 1,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    finishBatch?.([unitVector()]);

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(backend.cancel).toHaveBeenCalledTimes(1);
    expect(backend.embedBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid text and batch sizes before native work starts', async () => {
    const backend = createBackend();
    await expect(runLocalEmbeddingJob(backend, ['  '], 'document')).rejects.toBeInstanceOf(
      LocalEmbeddingJobError,
    );
    await expect(
      runLocalEmbeddingJob(backend, ['질문'], 'query', { batchSize: 9 }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(backend.prepare).not.toHaveBeenCalled();
  });
});
