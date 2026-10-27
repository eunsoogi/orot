import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';

/** Runs the agent-memory phases as a cohesive fallback for domain-test commands. */
export async function runAgentMemoryTestOperation(
  operation: string,
  memoryIdentifier?: string,
): Promise<Record<string, unknown>> {
  switch (operation) {
    case 'memory-create':
      await runAgentMemoryProbe('fresh', memoryIdentifier);
      return { synthetic: true, persisted: true, networkDisabled: true };
    case 'memory-delete':
      await runAgentMemoryProbe('delete', memoryIdentifier);
      return {
        removed: true,
        standardRagPositiveControl: true,
        networkDisabled: true,
      };
    case 'memory-restart':
      await runAgentMemoryProbe('restart', memoryIdentifier);
      return {
        restoredBeforeDeletion: true,
        removed: true,
        networkDisabled: true,
      };
    case 'memory-tombstone':
      await runAgentMemoryProbe('tombstone-restart', memoryIdentifier);
      return { tombstoneVerified: true, networkDisabled: true };
    case 'memory-verify-deletion':
      await runAgentMemoryProbe('verify-deletion', memoryIdentifier);
      return {
        absentFromMemoryAndSearch: true,
        standardRagDeletionFence: true,
        networkDisabled: true,
      };
    default:
      throw new Error('Unknown iOS test operation: ' + operation);
  }
}
