import { createAgentMemory } from '../src/service';
import { namespacedStorage } from '../src/namespacedStorage';
import { embedder, PersistentMemoryStorage, preference } from './testFixtures';
import type { PersistedMemoryRecord } from '../src/types';

function legacyRecord(): PersistedMemoryRecord {
  return {
    id: 'legacy-memory-id',
    text: preference.text,
    vector: new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    tags: ['preference'],
    entities: [],
    importance: 0.8,
    meta: {
      memoryKey: preference.memoryKey,
      kind: preference.kind,
      provenance: preference.provenance,
    },
    createdAt: 123456,
    reinforcements: 0,
  };
}

describe('trusted memory namespaces and durable key mapping', () => {
  it('reads, updates and deletes legacy keys after reopening without rewriting old rows on open', async () => {
    const storage = new PersistentMemoryStorage();
    const legacy = legacyRecord();
    await storage.append(legacy);
    const first = await createAgentMemory({ embedder, storage });
    expect(await first.getByKey(preference.memoryKey)).toMatchObject({
      id: legacy.id,
      createdAt: legacy.createdAt,
      provenance: preference.provenance,
    });
    expect(await storage.listRecords()).toEqual([legacy]);
    await expect(first.remember(preference)).resolves.toBe(legacy.id);
    await first.close();

    const second = await createAgentMemory({ embedder, storage, namespace: [] });
    const corrected = { ...preference, text: '다음 외래 알림은 오전에 받는다.' };
    const correctedId = await second.update(corrected);
    expect(correctedId).not.toBe(legacy.id);
    await second.close();
    const third = await createAgentMemory({ embedder, storage });
    await expect(third.getByKey(preference.memoryKey)).resolves.toEqual({
      memoryKey: preference.memoryKey,
      id: correctedId,
      text: corrected.text,
      kind: preference.kind,
      provenance: preference.provenance,
      createdAt: legacy.createdAt,
    });
    await expect(third.recall(corrected.text)).resolves.toMatchObject([{ id: correctedId }]);
    await expect(third.forgetByKey(preference.memoryKey)).resolves.toBe(true);
    await third.close();
    const fourth = await createAgentMemory({ embedder, storage });
    await expect(fourth.getByKey(preference.memoryKey)).resolves.toBeNull();
    await expect(fourth.forgetByKey(preference.memoryKey)).resolves.toBe(false);
    await fourth.close();
  });

  it('isolates identical keys and ranked recall before applying the result limit', async () => {
    const storage = new PersistentMemoryStorage();
    const alpha = await createAgentMemory({ embedder, storage, namespace: ['user', 'alpha'] });
    const alphaId = await alpha.remember(preference);
    await alpha.close();
    const beta = await createAgentMemory({ embedder, storage, namespace: ['user', 'beta'] });
    const betaId = await beta.remember({
      ...preference,
      text: `${preference.text} 오전에 받는다.`,
    });
    await expect(beta.recall(preference.text, { limit: 1 })).resolves.toMatchObject([
      { id: betaId },
    ]);
    await expect(beta.forget(alphaId)).resolves.toBe(false);
    await beta.update({ ...preference, text: '다른 알림 시간' });
    await beta.forgetByKey(preference.memoryKey);
    await beta.close();
    const reopened = await createAgentMemory({ embedder, storage, namespace: ['user', 'alpha'] });
    await expect(reopened.getByKey(preference.memoryKey)).resolves.toMatchObject({ id: alphaId });
    await reopened.close();
  });

  it('binds scope to trusted setup, handles delimiter collisions and excludes malformed metadata', async () => {
    const storage = new PersistentMemoryStorage();
    const namespace = ['a:b', 'c'];
    const memory = await createAgentMemory({ embedder, storage, namespace });
    namespace[0] = 'changed';
    // An extra draft field cannot redirect the service's trusted namespace.
    await memory.remember({ ...preference, ...{ namespace: ['attacker'] } });
    await memory.close();
    const collision = await createAgentMemory({ embedder, storage, namespace: ['a', 'b:c'] });
    await expect(collision.getByKey(preference.memoryKey)).resolves.toBeNull();
    await collision.close();
    const legacy = legacyRecord();
    await storage.append({ ...legacy, meta: { ...legacy.meta, namespace: null } });
    const defaultMemory = await createAgentMemory({ embedder, storage });
    await expect(defaultMemory.getByKey(preference.memoryKey)).resolves.toBeNull();
    await defaultMemory.close();
    expect((await storage.listRecords())[0]?.meta.namespace).toEqual(['a:b', 'c']);
    await expect(createAgentMemory({ embedder, storage, namespace: [' '] })).rejects.toThrow(
      'namespace',
    );
  });

  it('retains other namespaces during Rememori compaction', async () => {
    const storage = new PersistentMemoryStorage();
    const legacy = legacyRecord();
    const scoped = { ...legacy, id: 'scoped-id', meta: { ...legacy.meta, namespace: ['private'] } };
    await storage.append(legacy);
    await storage.append(scoped);
    const scopedStorage = namespacedStorage(storage, ['private']);
    await scopedStorage.compact([scoped]);
    expect(await storage.listRecords()).toEqual([legacy, scoped]);
    await scopedStorage.compact([]);
    expect(await storage.listRecords()).toEqual([legacy]);
  });

  it('applies live provenance invalidation to direct key reads', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    await memory.remember(preference);
    storage.invalidatedSourceIds.add(preference.provenance.sourceIds[0]!);
    await expect(memory.getByKey(preference.memoryKey)).resolves.toBeNull();
    await expect(memory.getByKey(' ')).rejects.toThrow('stable memory key');
    await expect(memory.forgetByKey(' ')).rejects.toThrow('stable memory key');
    await memory.close();
  });

  it('keeps the previous mapping after a failed scoped correction and restart', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage, namespace: ['reviewed'] });
    const id = await memory.remember(preference);
    storage.failNextCommit = true;
    await expect(memory.update({ ...preference, text: '수정한 알림' })).rejects.toThrow(
      'transaction',
    );
    await memory.close();
    const reopened = await createAgentMemory({ embedder, storage, namespace: ['reviewed'] });
    await expect(reopened.getByKey(preference.memoryKey)).resolves.toMatchObject({
      id,
      text: preference.text,
    });
    await reopened.close();
  });
});
