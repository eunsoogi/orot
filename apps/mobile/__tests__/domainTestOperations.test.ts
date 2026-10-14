jest.mock('../src/storage/e2eProbe', () => ({
  runStorageProbe: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/memory/agentMemoryProbe', () => ({
  runAgentMemoryProbe: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../e2e/graphIntegrationProbe', () => ({
  runGraphIntegrationProbe: jest
    .fn()
    .mockResolvedValue({ invocations: 20, streams: 20, duplicateNodes: 0 }),
}));

import { runDomainTestOperation } from '../e2e/domainTestOperations';
import { runStorageProbe } from '../src/storage/e2eProbe';
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';

test('routes encrypted storage and deletion operations to their existing assertion boundaries', async () => {
  await runDomainTestOperation('storage-create', {});
  await runDomainTestOperation('storage-read', {});
  expect(runStorageProbe).toHaveBeenNthCalledWith(1, 'fresh', undefined);
  expect(runStorageProbe).toHaveBeenNthCalledWith(2, 'restart', undefined);
  for (const operation of [
    'memory-create',
    'memory-delete',
    'memory-tombstone',
    'memory-verify-deletion',
  ])
    await runDomainTestOperation(operation, {});
  expect(
    (runAgentMemoryProbe as jest.Mock).mock.calls.map(call => call[0]),
  ).toEqual(['fresh', 'delete', 'tombstone-restart', 'verify-deletion']);
});
test('does not turn a failed domain assertion into a successful test report', async () => {
  (runStorageProbe as jest.Mock).mockRejectedValueOnce(
    new Error('wrong key was accepted'),
  );
  await expect(runDomainTestOperation('storage-create', {})).rejects.toThrow(
    'wrong key was accepted',
  );
  await expect(runDomainTestOperation('unknown-operation', {})).rejects.toThrow(
    'Unknown iOS test operation',
  );
});
