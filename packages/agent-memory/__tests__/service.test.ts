import { createAgentMemory } from '../src/service';
import { createAgentMemoryTools } from '../src/tools';
import type { AgentMemoryInput } from '../src/types';
import { embedder, PersistentMemoryStorage, preference } from './testFixtures';

describe('on-device agent memory lifecycle', () => {
  it('recalls persisted Korean memory and provenance after reopening', async () => {
    const storage = new PersistentMemoryStorage();
    const firstSession = await createAgentMemory({ embedder, storage });
    const id = await firstSession.remember(preference);
    await firstSession.close();

    const nextSession = await createAgentMemory({ embedder, storage });
    const [hit] = await nextSession.recall(preference.text);

    expect(hit).toMatchObject({ id, text: preference.text, kind: 'preference' });
    expect(hit?.provenance).toEqual(preference.provenance);
    await nextSession.close();
  });

  it('makes repeated ingestion idempotent and correction replace the prior memory', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const originalId = await memory.remember(preference);

    await expect(memory.remember(preference)).resolves.toBe(originalId);
    const correction = {
      ...preference,
      text: '사용자는 외래 일정 알림을 오전 10시에 받고 싶어 한다.',
    };
    const correctedId = await memory.update(correction);

    expect(correctedId).not.toBe(originalId);
    expect(await storage.listRecords()).toHaveLength(1);
    expect(await memory.recall(preference.text, { minSimilarity: 0.999 })).toEqual([]);
    await expect(memory.recall(correction.text)).resolves.toMatchObject([
      { id: correctedId, text: correction.text },
    ]);
    await memory.close();
  });

  it('serializes concurrent corrections and keeps one durable record for the key', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const first = { ...preference, text: '사용자는 오전 9시에 알림을 원한다.' };
    const second = { ...preference, text: '사용자는 오전 11시에 알림을 원한다.' };

    await Promise.all([memory.remember(first), memory.update(second)]);

    expect(await storage.listRecords()).toHaveLength(1);
    expect((await storage.listRecords())[0]?.text).toBe(second.text);
    await memory.close();
  });

  it('keeps the prior memory when an atomic correction commit fails', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const originalId = await memory.remember(preference);
    storage.failNextCommit = true;

    await expect(
      memory.update({
        ...preference,
        text: '사용자는 외래 일정 알림을 오전 10시에 받고 싶어 한다.',
      }),
    ).rejects.toThrow('Synthetic transaction failure.');

    expect(await storage.listRecords()).toMatchObject([{ id: originalId, text: preference.text }]);
    await expect(memory.recall(preference.text, { minSimilarity: 0.999 })).resolves.toMatchObject([
      { id: originalId, text: preference.text },
    ]);
    await memory.close();
  });

  it('rejects memories without an explicit review state', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const invalid = {
      ...preference,
      provenance: { sourceIds: [], reviewState: 'model_inferred' },
    } as unknown as AgentMemoryInput;

    await expect(memory.remember(invalid)).rejects.toThrow('user-confirmed or human-reviewed');
    expect(await storage.listRecords()).toEqual([]);
    await memory.close();
  });

  it('gates LangGraph writes and deletes on caller authorization', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const draft = {
      memoryKey: preference.memoryKey,
      text: preference.text,
      kind: preference.kind,
    };
    const deniedTools = createAgentMemoryTools(memory, {
      authorizeWrite: async () => null,
      authorizeDelete: async () => false,
    });

    await expect(deniedTools[0].invoke(draft)).resolves.toBe(
      JSON.stringify({ stored: false, reason: 'memory_write_not_authorized' }),
    );
    expect(await storage.listRecords()).toEqual([]);

    const authorizedTools = createAgentMemoryTools(memory, {
      authorizeWrite: async () => ({ provenance: preference.provenance }),
      authorizeDelete: async () => true,
    });
    const stored = JSON.parse(await authorizedTools[0].invoke(draft)) as {
      stored: boolean;
      id: string;
    };
    expect(stored.stored).toBe(true);
    await expect(authorizedTools[3].invoke({ memoryId: stored.id })).resolves.toBe(
      JSON.stringify({ deleted: true }),
    );
    expect(await storage.listRecords()).toEqual([]);
    await memory.close();
  });
});
