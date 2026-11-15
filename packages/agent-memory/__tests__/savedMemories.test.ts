import { listSavedMemories } from '../src/savedMemories';
import { PersistentMemoryStorage } from './testFixtures';
import type { PersistedMemoryRecord } from '../src/types';

function row(id: string, createdAt = 100): PersistedMemoryRecord {
  return {
    id,
    text: `Synthetic ${id}`,
    createdAt,
    importance: 0.8,
    meta: {
      memoryKey: id,
      kind: 'preference',
      provenance: {
        sourceIds: [`source-${id}`],
        reviewState: 'user_confirmed',
      },
    },
  } as PersistedMemoryRecord;
}

it('enumerates durable rows without a query or embedding and orders ties by identity', async () => {
  const storage = new PersistentMemoryStorage();
  for (const record of [row('b'), row('c', 200), row('a')]) await storage.append(record);
  expect((await listSavedMemories(storage)).map((item) => item.id)).toEqual(['c', 'a', 'b']);
});

it('excludes non-default namespaces, malformed metadata and invalid creation dates', async () => {
  const storage = new PersistentMemoryStorage();
  const other = row('other');
  other.meta.namespace = ['private-thread'];
  const malformed = row('bad');
  malformed.meta.provenance = {};
  for (const record of [row('ok'), other, malformed, row('date', Infinity)])
    await storage.append(record);
  expect((await listSavedMemories(storage)).map((item) => item.id)).toEqual(['ok']);
});

it('honors source and memory ID fences even when the adapter returns stale rows', async () => {
  const storage = new PersistentMemoryStorage();
  jest
    .spyOn(storage, 'listRecords')
    .mockResolvedValue([row('removed'), row('invalid'), row('self'), row('ok')]);
  jest.spyOn(storage, 'listRemovedSourceIds').mockResolvedValue(['source-removed', 'self']);
  jest.spyOn(storage, 'listInvalidatedSourceIds').mockResolvedValue(['source-invalid']);
  expect((await listSavedMemories(storage)).map((item) => item.id)).toEqual(['ok']);
});

it('rejects a quarantine race rather than reporting an empty database', async () => {
  const storage = Object.assign(new PersistentMemoryStorage(), {
    listQuarantineRevision: jest.fn().mockResolvedValueOnce('1').mockResolvedValueOnce('2'),
  });
  await expect(listSavedMemories(storage)).rejects.toThrow('changed during reading');
});

it('distinguishes an empty store from a failed protected read', async () => {
  const storage = new PersistentMemoryStorage();
  expect(await listSavedMemories(storage)).toEqual([]);
  jest.spyOn(storage, 'listRecords').mockRejectedValue(new Error('locked'));
  await expect(listSavedMemories(storage)).rejects.toThrow('locked');
});
