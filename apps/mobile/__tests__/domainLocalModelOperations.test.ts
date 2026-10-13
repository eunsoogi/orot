jest.mock('../src/storage/e2eProbe', () => ({ runStorageProbe: jest.fn() }));
jest.mock('../src/memory/agentMemoryProbe', () => ({
  runAgentMemoryProbe: jest.fn(),
}));
jest.mock('../e2e/graphIntegrationProbe', () => ({
  runGraphIntegrationProbe: jest.fn(),
}));
jest.mock('../e2e/localE5EmbeddingProbe', () => ({
  runLocalE5EmbeddingProbe: jest.fn(),
}));
jest.mock('../e2e/hybridRetrievalProbe', () => ({
  runHybridRetrievalProbe: jest.fn(),
}));

import { runDomainTestOperation } from '../e2e/domainTestOperations';
import { runLocalE5EmbeddingProbe } from '../e2e/localE5EmbeddingProbe';
import { runHybridRetrievalProbe } from '../e2e/hybridRetrievalProbe';

test('local model routing retains the actual measurement object and rejects invalid modes before indexing', async () => {
  const probe = runLocalE5EmbeddingProbe as jest.Mock;
  for (const mode of ['fresh', 'restart']) {
    const result = {
      mode,
      runtime: { modelLoaded: true, footprintAfterLoadBytes: 1234 },
    };
    probe.mockResolvedValueOnce(result);
    await expect(runDomainTestOperation('local-e5', { mode })).resolves.toEqual(
      { result, syntheticCorpus: true },
    );
    expect(probe).toHaveBeenLastCalledWith(mode);
  }
  for (const mode of [undefined, 'unknown', 1]) {
    await expect(runDomainTestOperation('local-e5', { mode })).rejects.toThrow(
      'valid E5 mode',
    );
  }
  expect(probe).toHaveBeenCalledTimes(2);
  probe.mockRejectedValueOnce(new Error('native model failed'));
  await expect(
    runDomainTestOperation('local-e5', { mode: 'fresh' }),
  ).rejects.toThrow('native model failed');
});

test('hybrid routing keeps persisted-mode selection and propagates the original SQL/FTS failures', async () => {
  const probe = runHybridRetrievalProbe as jest.Mock;
  const result = {
    mode: 'reopened',
    remainingVectorCount: 1,
    ftsOnly: { lexicalRank: 1, vectorRank: null },
  };
  probe.mockResolvedValueOnce(result);
  await expect(runDomainTestOperation('hybrid-retrieval', {})).resolves.toEqual(
    { result, syntheticCorpus: true },
  );
  expect(probe).toHaveBeenCalledWith();
  probe.mockRejectedValueOnce(new Error('native vector state failed'));
  await expect(runDomainTestOperation('hybrid-retrieval', {})).rejects.toThrow(
    'native vector state failed',
  );
});
