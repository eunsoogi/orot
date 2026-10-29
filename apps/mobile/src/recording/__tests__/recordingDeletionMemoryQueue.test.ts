import { createAgentMemory } from '@orot/agent-memory';
import {
  PersistentMemoryStorage,
  embedder,
  preference,
} from '../../../../../packages/agent-memory/__tests__/testFixtures';

test.each([false, true])(
  'source removal waits for an earlier embedding without losing deletion fences (embedding fails: %s)',
  async failEmbedding => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({
      storage,
      embedder: {
        async embed(texts: string[]) {
          entered();
          await held;
          if (failEmbedding) throw new Error('embedding failed');
          return embedder.embed(texts);
        },
      },
    });
    const write = memory.remember(preference).catch(error => error);
    await started;
    let deletionSettled = false;
    const deleteSource = jest.fn(async () => {
      // A source transaction must not race ahead of the memory batch or its persistent fence.
      expect(await storage.listRecords()).toEqual([]);
      expect(await storage.listRemovedSourceIds()).toContain(
        'synthetic-source-1',
      );
      return true;
    });
    const deletion = memory
      .removeSource('synthetic-source-1', deleteSource)
      .then(result => {
        deletionSettled = true;
        return result;
      });
    await Promise.resolve();
    expect(deletionSettled).toBe(false);
    expect(deleteSource).not.toHaveBeenCalled();
    release();
    await write;
    await expect(deletion).resolves.toEqual({
      sourceDeleted: true,
      memoriesDeleted: failEmbedding ? 0 : 1,
    });
    await expect(memory.remember(preference)).rejects.toThrow(
      'already removed',
    );
    await memory.close();
  },
);
