jest.mock('../src/storage/e2eProbe', () => ({ runStorageProbe: jest.fn() }));
jest.mock('../src/memory/agentMemoryProbe', () => ({
  runAgentMemoryProbe: jest.fn(),
}));
jest.mock('../e2e/graphIntegrationProbe', () => ({
  runGraphIntegrationProbe: jest.fn(),
}));
jest.mock('../e2e/ragWorkflowProbe', () => ({
  runRagWorkflowProbe: jest.fn(),
}));
// Dispatch verification uses a synthetic wrapper; actual retrieval and the bridge run in the Simulator suite.
jest.mock('../e2e/appleModelMockBridge', () => ({
  withMockAppleModel: jest.fn(async (_script, run) => ({
    ...(await run()),
    modelExecution: 'mock',
    actualModel: 'not-run',
  })),
}));

import { runDomainTestOperation } from '../e2e/domainTestOperations';
import { runRagWorkflowProbe } from '../e2e/ragWorkflowProbe';

test('RAG routing labels mock inference and preserves retrieval and provider outcomes', async () => {
  const probe = runRagWorkflowProbe as jest.Mock;
  for (const terminal of [
    'answer',
    'unavailable-safe-failure',
    'deadline-exceeded',
  ]) {
    const result = {
      availability: 'available',
      terminal,
      retrieval: 'observed',
      requests: ['https://example.test/synthetic'],
      responses: [{ status: 200 }],
      publications: [{ title: 'Synthetic fixture' }],
      outcome: { status: terminal, citations: [] },
      diagnostics: [{ status: terminal }],
    };
    probe.mockResolvedValueOnce(result);
    await expect(runDomainTestOperation('rag-workflow', {})).resolves.toEqual({
      ...result,
      modelExecution: 'mock',
      actualModel: 'not-run',
    });
  }
  expect(probe).toHaveBeenCalledWith(
    expect.any(Function),
    expect.any(AbortSignal),
  );
  probe.mockRejectedValueOnce(new Error('native retrieval failed'));
  await expect(runDomainTestOperation('rag-workflow', {})).rejects.toThrow(
    'native retrieval failed',
  );
});
