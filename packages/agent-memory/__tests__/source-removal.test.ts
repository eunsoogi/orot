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

  it('forgets linked and unlinked memories and persists source fences after reopening', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const linkedId = await memory.remember(preference);
    const unlinked = {
      ...preference,
      memoryKey: 'reviewed:care-preference',
      text: '합성 사용자 검토 선호 내용.',
      provenance: { sourceIds: [], reviewState: 'human_reviewed' as const },
    };
    const unlinkedId = await memory.remember(unlinked);

    await expect(memory.forgetAll(['synthetic-source-2'])).resolves.toBe(2);
    expect(await storage.listRecords()).toEqual([]);
    expect(new Set(await storage.listRemovedSourceIds())).toEqual(
      new Set(['synthetic-source-1', 'synthetic-source-2', linkedId, unlinkedId]),
    );
    await memory.close();

    const reopened = await createAgentMemory({ embedder, storage });
    await expect(reopened.recall(preference.text)).resolves.toEqual([]);
    await expect(
      reopened.remember({
        ...unlinked,
        memoryKey: 'preference:stale-memory-reference',
        provenance: {
          sourceIds: [unlinkedId],
          reviewState: 'human_reviewed',
        },
      }),
    ).rejects.toThrow('already removed');
    await expect(reopened.remember(preference)).rejects.toThrow('already removed');
    await expect(reopened.remember(unlinked)).resolves.not.toBe(linkedId);
    await reopened.close();
  });

  it('keeps all memories and source fences unchanged when the clear batch fails', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const linkedId = await memory.remember(preference);
    const unlinked = {
      ...preference,
      memoryKey: 'reviewed:care-preference',
      text: '합성 사용자 검토 선호 내용.',
      provenance: { sourceIds: [], reviewState: 'human_reviewed' as const },
    };
    const unlinkedId = await memory.remember(unlinked);
    storage.failNextCommit = true;

    await expect(memory.forgetAll(['synthetic-source-2'])).rejects.toThrow(
      'Synthetic transaction failure.',
    );

    expect(await storage.listRecords()).toMatchObject([
      { id: linkedId, text: preference.text },
      { id: unlinkedId, text: unlinked.text },
    ]);
    expect(await storage.listRemovedSourceIds()).toEqual([]);
    await expect(memory.recall(preference.text, { minSimilarity: 0.999 })).resolves.toHaveLength(1);
    await memory.close();
  });

  it('serializes removal and rejects concurrent and persisted stale writes', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const linkedId = await memory.remember(preference);
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
    expect(await storage.listRemovedSourceIds()).toContain(linkedId);
    await memory.close();
    await staleWriter.close();

    const reopened = await createAgentMemory({ embedder, storage });
    await expect(reopened.remember(preference)).rejects.toThrow('already removed');
    await expect(reopened.recall(preference.text)).resolves.toEqual([]);
    await reopened.close();
  });

  it('observes a held queue and provenance scan without emitting record data', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    await memory.remember(preference);
    let enterPrior!: () => void;
    let releasePrior!: () => void;
    const priorEntered = new Promise<void>((resolve) => {
      enterPrior = resolve;
    });
    const holdPrior = new Promise<void>((resolve) => {
      releasePrior = resolve;
    });
    const prior = memory.removeSource('synthetic-prior', async () => {
      enterPrior();
      await holdPrior;
      return true;
    });
    await priorEntered;

    let now = 0;
    const observations: [string, string, number][] = [];
    const read = storage.listRecords.bind(storage);
    const scan = jest.spyOn(storage, 'listRecords').mockImplementation(async () => {
      now += 40;
      return read();
    });
    const deletion = memory.removeSource(
      'synthetic-source-1',
      async () => true,
      [],
      undefined,
      (stage, event) => observations.push([stage, event, now]),
    );
    now = 5_000;
    expect(observations).toEqual([['queue', 'begin', 0]]);
    expect(scan).not.toHaveBeenCalled();
    releasePrior();
    await prior;
    await expect(deletion).resolves.toEqual({ sourceDeleted: true, memoriesDeleted: 1 });
    expect(observations).toEqual([
      ['queue', 'begin', 0],
      ['queue', 'success', 5_000],
      ['provenance', 'begin', 5_000],
      ['provenance', 'success', 5_040],
    ]);
    await memory.close();
  });

  it('keeps memory writable when the source-removal batch fails', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const originalId = await memory.remember(preference);
    storage.failNextCommit = true;

    await expect(memory.removeSource('synthetic-source-1', async () => true)).rejects.toThrow(
      'Synthetic transaction failure.',
    );

    expect(await storage.listRecords()).toMatchObject([{ id: originalId, text: preference.text }]);
    expect(await storage.listRemovedSourceIds()).toEqual([]);
    await expect(
      memory.remember({ ...preference, memoryKey: 'preference:retry-after-failure' }),
    ).resolves.not.toBe(originalId);
    await memory.close();
  });

  it('forgets memories linked only to a deleted transcript revision and fences that revision after reopening', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const transcriptRevisionId = 'recording-1:segment:0:r1';
    const transcriptMemory = {
      ...preference,
      memoryKey: 'transcript:recording-1:0',
      text: '합성 전사 문장만 참조하는 메모리.',
      provenance: {
        sourceIds: [transcriptRevisionId],
        reviewState: 'human_reviewed' as const,
      },
    };
    await memory.remember(transcriptMemory);

    await expect(
      memory.removeSource('recording-1', async () => true, [transcriptRevisionId]),
    ).resolves.toEqual({ sourceDeleted: true, memoriesDeleted: 1 });
    expect(await storage.listRecords()).toEqual([]);
    expect(await storage.listRemovedSourceIds()).toEqual(
      expect.arrayContaining(['recording-1', transcriptRevisionId]),
    );
    await memory.close();

    const reopened = await createAgentMemory({ embedder, storage });
    await expect(reopened.remember(transcriptMemory)).rejects.toThrow('already removed');
    await reopened.close();
  });
});
