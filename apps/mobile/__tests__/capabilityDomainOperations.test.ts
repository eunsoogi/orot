jest.mock('../src/storage/e2eProbe', () => ({ runStorageProbe: jest.fn() }));
jest.mock('../src/memory/agentMemoryProbe', () => ({
  runAgentMemoryProbe: jest.fn(),
}));
jest.mock('../e2e/graphIntegrationProbe', () => ({
  runGraphIntegrationProbe: jest.fn(),
}));
jest.mock('../e2e/appleFoundationModelsProbe', () => ({
  runAppleFoundationModelsProbe: jest.fn(),
}));
jest.mock('../e2e/localRecordQueryProbe', () => ({
  runLocalQueryIntegrationProbe: jest.fn(),
}));
// This unit boundary checks dispatch and validation; the Simulator suite executes the real mock-control bridge.
jest.mock('../e2e/appleModelMockBridge', () => ({
  withMockAppleModel: jest.fn(async (_script, run) => ({
    ...(await run()),
    modelExecution: 'mock',
    actualModel: 'not-run',
  })),
}));
jest.mock('../e2e/appleModelMockBridgeProbe', () => ({
  runAppleModelMockBridgeProbe: jest.fn(async () => ({
    unitRoutingFixture: true,
  })),
}));

import { runDomainTestOperation } from '../e2e/domainTestOperations';
import { runAppleFoundationModelsProbe } from '../e2e/appleFoundationModelsProbe';
import { runLocalQueryIntegrationProbe } from '../e2e/localRecordQueryProbe';

const unavailable = {
  availability: 'unsupportedDevice',
  generation: 'not-run',
  sourceIdPreserved: 'not-run',
  questionText: 'not-run',
  cancellation: 'not-run',
  inferenceStop: 'unverified',
};
const available = {
  availability: 'available',
  generation: 'passed',
  sourceIdPreserved: 'passed',
  questionText: '선생님, 수면 변화에 관해 무엇을 확인하면 좋을까요?',
  cancellation: 'cancelled',
  inferenceStop: 'unverified',
};

const expected = (result: object) => ({
  ...result,
  modelExecution: 'mock',
  actualModel: 'not-run',
  bridge: { unitRoutingFixture: true },
});

test('preserves an unavailable fixture without manufacturing generation or cancellation', async () => {
  (runAppleFoundationModelsProbe as jest.Mock).mockResolvedValueOnce(
    unavailable,
  );
  await expect(runDomainTestOperation('apple-model', {})).resolves.toEqual(
    expected(unavailable),
  );
  expect(runAppleFoundationModelsProbe).toHaveBeenCalledTimes(1);
});

test('preserves the original available-branch question and source validation', async () => {
  (runAppleFoundationModelsProbe as jest.Mock).mockResolvedValueOnce(available);
  await expect(runDomainTestOperation('apple-model', {})).resolves.toEqual(
    expected(available),
  );
  for (const result of [
    { ...available, sourceIdPreserved: 'failed' },
    { ...available, questionText: '약을 중단하세요?' },
    { ...available, questionText: ' ' + available.questionText },
  ]) {
    (runAppleFoundationModelsProbe as jest.Mock).mockResolvedValueOnce(result);
    await expect(runDomainTestOperation('apple-model', {})).rejects.toThrow();
  }
});

test('requires the local query scope and propagates a failed cleanup assertion', async () => {
  await expect(runDomainTestOperation('local-query', {})).rejects.toThrow(
    'isolated fixture identifier',
  );
  expect(runLocalQueryIntegrationProbe).not.toHaveBeenCalled();
  (runLocalQueryIntegrationProbe as jest.Mock).mockRejectedValueOnce(
    new Error('cleanup failed'),
  );
  const queryIdentifier = 'test-query-11111111-2222-4333-8444-555555555555';
  await expect(
    runDomainTestOperation('local-query', {
      queryIdentifier,
    }),
  ).rejects.toThrow('cleanup failed');
  expect(runLocalQueryIntegrationProbe).toHaveBeenCalledWith(queryIdentifier);
});
