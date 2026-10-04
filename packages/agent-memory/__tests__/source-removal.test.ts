import { createAgentMemory } from '../src/service';
import { PersistentMemoryStorage, embedder, preference } from './testFixtures';

describe('agent memory source removal', () => {
  it('forgets only memories linked to the removed source', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    await memory.remember(preference);
    await memory.remember({
      ...preference,
      memoryKey: 'task:visit-prep',
      text: '진료 전에 복용 목록을 확인한다.',
      kind: 'task_context',
      provenance: { sourceIds: ['synthetic-source-2'], reviewState: 'human_reviewed' },
    });

    await expect(memory.forgetBySourceId('synthetic-source-1')).resolves.toBe(1);
    expect(await storage.listRecords()).toHaveLength(1);
    expect((await storage.listRecords())[0]?.meta.provenance).toMatchObject({
      sourceIds: ['synthetic-source-2'],
    });
    await memory.close();
  });

  it('serializes removal and rejects concurrent and persisted stale writes', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    await memory.remember(preference);
    const staleWriter = await createAgentMemory({ embedder, storage });
    let beginDelete!: () => void;
    let finishDelete!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      beginDelete = resolve;
    });
    const continueDelete = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });

    const removal = memory.removeSource('synthetic-source-1', async () => {
      beginDelete();
      await continueDelete;
      return true;
    });
    await deleteStarted;
    const queuedWrite = memory.remember({ ...preference, memoryKey: 'preference:late-write' });
    await expect(
      staleWriter.remember({ ...preference, memoryKey: 'preference:stale-writer' }),
    ).rejects.toThrow('already removed');

    finishDelete();
    await expect(removal).resolves.toEqual({ sourceDeleted: true, memoriesDeleted: 1 });
    await expect(queuedWrite).rejects.toThrow('already removed');
    expect(await storage.listRecords()).toEqual([]);
    await memory.close();
    await staleWriter.close();

    const reopened = await createAgentMemory({ embedder, storage });
    await expect(reopened.remember(preference)).rejects.toThrow('already removed');
    await expect(reopened.recall(preference.text)).resolves.toEqual([]);
    await reopened.close();
  });
});
