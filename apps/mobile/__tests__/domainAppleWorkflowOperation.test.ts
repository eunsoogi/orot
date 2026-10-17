jest.mock('../src/storage/e2eProbe', () => ({ runStorageProbe: jest.fn() }));
jest.mock('../src/memory/agentMemoryProbe', () => ({
  runAgentMemoryProbe: jest.fn(),
}));
jest.mock('../e2e/graphIntegrationProbe', () => ({
  runGraphIntegrationProbe: jest.fn(),
}));
jest.mock('../e2e/appleWorkflowProbe', () => ({
  runAppleWorkflowProbe: jest.fn(),
}));
jest.mock('../e2e/appleModelMockBridge', () => ({
  withMockAppleModel: jest.fn(async (_script, run) => ({
    ...(await run()),
    modelExecution: 'mock',
    actualModel: 'not-run',
  })),
}));

import { runDomainTestOperation } from '../e2e/domainTestOperations';
import { runAppleWorkflowProbe } from '../e2e/appleWorkflowProbe';

test('workflow routing declares mock evidence and preserves workflow outcomes and failures', async () => {
  const result = {
    availability: 'available',
    calendar: { status: 'complete' },
    nextVisit: { status: 'ready', questions: [{ citations: [{}] }] },
    cancellation: {
      providerStarted: true,
      abortSent: true,
      result: { status: 'cancelled' },
      inferenceStop: 'unverified',
    },
    diagnostics: [{ phase: 'calendar', result: { status: 'completed' } }],
  };
  const probe = runAppleWorkflowProbe as jest.Mock;
  probe.mockResolvedValueOnce(result);
  await expect(runDomainTestOperation('apple-workflow', {})).resolves.toEqual({
    ...result,
    modelExecution: 'mock',
    actualModel: 'not-run',
  });
  expect(probe).toHaveBeenCalledWith(expect.any(Function));
  probe.mockRejectedValueOnce(new Error('model bridge failed'));
  await expect(runDomainTestOperation('apple-workflow', {})).rejects.toThrow(
    'model bridge failed',
  );
});
