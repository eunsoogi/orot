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

import { runDomainTestOperation } from '../e2e/domainTestOperations';
import { runAppleWorkflowProbe } from '../e2e/appleWorkflowProbe';

test('native workflow routing preserves actual provider outcomes and rejects probe failures', async () => {
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
  await expect(runDomainTestOperation('apple-workflow', {})).resolves.toEqual(
    result,
  );
  expect(probe).toHaveBeenCalledWith(expect.any(Function));
  probe.mockRejectedValueOnce(new Error('native provider failed'));
  await expect(runDomainTestOperation('apple-workflow', {})).rejects.toThrow(
    'native provider failed',
  );
});
