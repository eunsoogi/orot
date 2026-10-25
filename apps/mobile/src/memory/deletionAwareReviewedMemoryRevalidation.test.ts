import { createAgentMemory } from '@orot/agent-memory';
import type { AgentMemoryInput } from '@orot/agent-memory';
import type { EvidenceReference } from '@orot/agent-runtime';
import { openEncryptedStorage } from '@orot/storage';
import {
  createDatabase,
  options,
} from '../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';
import { withLocalDeletionAwareRevalidation } from './deletionAwareEvidenceRevalidation';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const deletionTestEmbedder = {
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(text => {
      const vector = new Float32Array(16);
      for (const character of text)
        vector[character.charCodeAt(0) % vector.length] += 1;
      return vector;
    });
  },
};

describe('deleted reviewed-memory revalidation', () => {
  it('rejects a saved memory reference after forgetAll removes the memory row', async () => {
    const database = createDatabase();
    let memoryClosed = false;
    let closeMemory: (() => Promise<void>) | undefined;
    try {
      await openEncryptedStorage(options(database));
      const memoryStorage = new SqlCipherAgentMemoryStorage(database);
      const memory = await createAgentMemory({
        embedder: deletionTestEmbedder,
        storage: memoryStorage,
      });
      closeMemory = () => memory.close();
      const memoryInput: AgentMemoryInput = {
        memoryKey: 'reviewed:clearable-memory',
        text: 'A synthetic reviewed memory with no source references.',
        kind: 'task_context',
        provenance: { sourceIds: [], reviewState: 'human_reviewed' },
      };
      const memoryId = await memory.remember(memoryInput);
      await expect(memory.forgetAll()).resolves.toBe(1);
      await memory.close();
      memoryClosed = true;
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
      const reference: EvidenceReference = {
        sourceKind: 'reviewed_memory',
        sourceId: memoryId,
        sourceRevision: 'memory-revision-1',
        evidenceId: memoryId,
        evidenceRevision: 'memory-revision-1',
        locator: { kind: 'memory_record', recordId: memoryId },
        effectiveTime: null,
        reviewState: 'reviewed',
      };
      const revalidate = jest.fn(async () => true);

      // The persisted row-ID fence must reject a checkpoint after Rememori deletes the row.
      const accepted = await withLocalDeletionAwareRevalidation(revalidate)(
        [reference],
        new AbortController().signal,
      );

      expect(accepted).toBe(false);
      expect(revalidate).not.toHaveBeenCalled();
      await expect(memoryStorage.listRemovedSourceIds()).resolves.toContain(
        memoryId,
      );
    } finally {
      if (!memoryClosed) await closeMemory?.();
      await database.closeAsync?.();
    }
  });
});
