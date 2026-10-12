import { runStorageProbe } from '../src/storage/e2eProbe';
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';
import { runGraphIntegrationProbe } from './graphIntegrationProbe';

/** Each operation keeps its original domain assertions; no UI status is treated as a native result. */
export async function runDomainTestOperation(
  operation: string,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (
    parameters.fixtureIdentifier !== undefined &&
    typeof parameters.fixtureIdentifier !== 'string'
  )
    throw new Error('A memory fixture identifier must be a string');
  const memoryIdentifier =
    typeof parameters.fixtureIdentifier === 'string'
      ? parameters.fixtureIdentifier
      : undefined;
  const storageIdentifier =
    typeof parameters.storageIdentifier === 'string'
      ? parameters.storageIdentifier
      : undefined;
  switch (operation) {
    case 'connection':
      return { connected: true };
    case 'graph':
      return runGraphIntegrationProbe();
    case 'healthkit': {
      const { runHealthKitIntegrationProbe } = await import('./healthkitProbe');
      return { summary: await runHealthKitIntegrationProbe(), synthetic: true };
    }
    case 'sleep-import': {
      const { runSleepIntegrationProbe } = await import('./sleepImportProbe');
      return { summary: await runSleepIntegrationProbe(), synthetic: true };
    }
    case 'storage-create':
      await runStorageProbe('fresh', storageIdentifier);
      return { encrypted: true, wrongKeyRejected: true, recordsVerified: true };
    case 'storage-read':
      await runStorageProbe('restart', storageIdentifier);
      return { sourceAndEvidenceRestored: true, ragChunksVerified: true };
    case 'memory-create':
      await runAgentMemoryProbe('fresh', memoryIdentifier);
      return { synthetic: true, persisted: true, networkDisabled: true };
    case 'memory-delete':
      await runAgentMemoryProbe('delete', memoryIdentifier);
      return { removed: true, networkDisabled: true };
    case 'memory-tombstone':
      await runAgentMemoryProbe('tombstone-restart', memoryIdentifier);
      return { tombstoneVerified: true, networkDisabled: true };
    case 'memory-verify-deletion':
      await runAgentMemoryProbe('verify-deletion', memoryIdentifier);
      return { absentFromMemoryAndSearch: true, networkDisabled: true };
    default:
      throw new Error('Unknown native domain operation: ' + operation);
  }
}
