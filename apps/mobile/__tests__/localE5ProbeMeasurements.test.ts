jest.mock('../src/rag/localE5RagService', () => ({
  openLocalE5RagService: jest.fn(),
}));
jest.mock('../src/rag/localE5NativeBackend', () => ({
  getLocalE5NativeModelIdentity: jest.fn(),
  getLocalE5NativeRuntimeMetrics: jest.fn(),
}));
jest.mock('../e2e/localE5CancellationProbe', () => ({
  cancelOneInFlightBatch: jest.fn(),
}));
jest.mock('../src/storage/ragEmbeddingStorage', () => ({
  SqlCipherRagEmbeddingStorage: jest.fn(),
}));
jest.mock('../src/storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

import { runLocalE5EmbeddingProbe } from '../e2e/localE5EmbeddingProbe';
import { openLocalE5RagService } from '../src/rag/localE5RagService';
import {
  getLocalE5NativeModelIdentity,
  getLocalE5NativeRuntimeMetrics,
} from '../src/rag/localE5NativeBackend';
import { cancelOneInFlightBatch } from '../e2e/localE5CancellationProbe';
import { SqlCipherRagEmbeddingStorage } from '../src/storage/ragEmbeddingStorage';
import { openLocalStorage } from '../src/storage/secureDatabase';

const ids = [
  'korean-bp-medication',
  'korean-stomach-symptom',
  'korean-sleep',
  'korean-walk',
  'korean-lab',
];

/** Synthetic backend observations exercise the real probe's unchanged quality oracle, not native model acceptance. */
function observations(ranks: readonly number[], completed = [1]) {
  const rows = new Map<string, unknown>();
  (openLocalStorage as jest.Mock).mockResolvedValue({
    get: async (kind: string, id: string) => rows.get(kind + ':' + id) ?? null,
    put: async (kind: string, value: { id: string }) =>
      rows.set(kind + ':' + value.id, value),
  });
  const identity = {
    modelId: 'synthetic-model',
    revision: 'synthetic',
    dimension: 384,
  };
  let query = 0;
  (openLocalE5RagService as jest.Mock).mockResolvedValue({
    provider: { modelIdentity: identity },
    index: async (
      _: unknown,
      options: { onProgress: (value: unknown) => void },
    ) => {
      completed.forEach(value =>
        options.onProgress({
          stage: 'model_download',
          completed: value,
          total: 10,
        }),
      );
    },
    search: async () => {
      const index = query++;
      // Match the shipping missing-record fence; real SQLite exercises it independently in retrievalCorpusPersistence.test.ts.
      return ranks[index] < 0 || !rows.has('symptom_entry:' + ids[index])
        ? []
        : Array.from({ length: ranks[index] + 1 }, (_, rank) => ({
            chunk: {
              id: rank === ranks[index] ? ids[index] : 'synthetic-unrelated',
            },
          }));
    },
  });
  (getLocalE5NativeModelIdentity as jest.Mock).mockResolvedValue(identity);
  (getLocalE5NativeRuntimeMetrics as jest.Mock).mockResolvedValue({
    modelLoaded: true,
    downloadMilliseconds: 1,
    sessionLoadMilliseconds: 1,
    footprintAfterLoadBytes: 1,
    inferenceMilliseconds: 1,
    inferencePeakFootprintBytes: 1,
  });
  (cancelOneInFlightBatch as jest.Mock).mockResolvedValue({
    outcome: 'cancelled',
    responseMilliseconds: 1,
    settlementMilliseconds: 2,
  });
  (SqlCipherRagEmbeddingStorage as jest.Mock).mockImplementation(() => ({
    listForModel: async () => Array.from({ length: 6 }, () => ({})),
  }));
}

test('retains the passing synthetic measurements and ordered cancellation observations', async () => {
  observations([0, 0, 0, 0, 0]);
  await expect(runLocalE5EmbeddingProbe('fresh')).resolves.toMatchObject({
    top1: 5,
    recallAt3: 5,
    meanReciprocalRank: 1,
    persistedVectorCount: 6,
    cancellation: 'cancelled',
    cancellationResponseMilliseconds: 1,
    cancellationSettlementMilliseconds: 2,
  });
});

test('retains a failed quality result and its actual numeric measurements', async () => {
  observations([1, 1, 1, 1, 1]);
  await expect(runLocalE5EmbeddingProbe('fresh')).rejects.toThrow(
    /top-1 and reciprocal-rank targets.*"top1":0.*"recallAt3":5.*"meanReciprocalRank":0.5/,
  );
});

test('retains the independent top-three completeness gate and its observed count', async () => {
  observations([0, 0, 0, 0, -1]);
  await expect(runLocalE5EmbeddingProbe('fresh')).rejects.toThrow(
    /every expected record in the top three.*"top1":4.*"recallAt3":4/,
  );
});

test('rejects backwards progress and preserves the exact pair with quality measurements', async () => {
  observations([0, 0, 0, 0, 0], [1, 5, 2, 10]);
  await expect(runLocalE5EmbeddingProbe('fresh')).rejects.toThrow(
    /progress moved backwards.*"top1":5.*backwards=.*"completed":5.*"completed":2/,
  );
});
