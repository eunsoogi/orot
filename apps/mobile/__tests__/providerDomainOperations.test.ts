jest.mock('../src/storage/e2eProbe', () => ({ runStorageProbe: jest.fn() }));
jest.mock('../src/memory/agentMemoryProbe', () => ({
  runAgentMemoryProbe: jest.fn(),
}));
jest.mock('../e2e/graphIntegrationProbe', () => ({
  runGraphIntegrationProbe: jest.fn(),
}));
jest.mock('../e2e/openaiProviderProbe', () => ({
  runOpenAIProviderIntegrationProbe: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../e2e/openaiToolsProviderProbe', () => ({
  runOpenAIToolsIntegrationProbe: jest.fn().mockResolvedValue(undefined),
}));

import { runDomainTestOperation } from '../e2e/domainTestOperations';
import { runOpenAIProviderIntegrationProbe } from '../e2e/openaiProviderProbe';
import { runOpenAIToolsIntegrationProbe } from '../e2e/openaiToolsProviderProbe';

test('runs the original native-backed provider assertions before reporting a synthetic result', async () => {
  await expect(runDomainTestOperation('openai-provider', {})).resolves.toEqual({
    synthetic: true,
    realAccount: 'unverified',
    assertions: 'catalog-stream-rate-limit-cancellation',
  });
  expect(runOpenAIProviderIntegrationProbe).toHaveBeenCalledTimes(1);
  await expect(runDomainTestOperation('openai-tools', {})).resolves.toEqual({
    synthetic: true,
    realAccount: 'unverified',
    assertions: 'definitions-stream-tool-result-hosted-rejection',
  });
  expect(runOpenAIToolsIntegrationProbe).toHaveBeenCalledTimes(1);
});

test('preserves a failed provider assertion instead of returning success', async () => {
  (runOpenAIProviderIntegrationProbe as jest.Mock).mockRejectedValueOnce(
    new Error('stream cancellation did not close'),
  );
  await expect(runDomainTestOperation('openai-provider', {})).rejects.toThrow(
    'stream cancellation did not close',
  );
});
