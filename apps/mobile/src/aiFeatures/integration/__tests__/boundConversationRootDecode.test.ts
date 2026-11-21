import * as codec from '../../../storage/conversationArtifactCodec';
import { readOwnedBoundParentRows } from '../../../storage/conversationArtifactRead';
import { boundConversationDigestFixture as fixture } from '../testSupport/boundConversationDigestFixture';

test('only exact adjacent owned root bytes reuse a decode, never public rows or a later transaction', async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  const operation = f.storage.beginReadOperation(signal)!;
  const id = f.parent.id;
  const other = 'other-root-decode';
  await f.storage.append({ ...f.parent, id: other });
  const decode = jest.spyOn(codec, 'decodeConversationArtifact');
  const roots = f.observeRoots(new Set([id, other]));
  const rootDecodes = () =>
    decode.mock.results.filter(({ value }) => value?.id === id).length;
  try {
    const ids = [id, id, other, id, id];
    const first = await readOwnedBoundParentRows(
      operation,
      f.storage,
      signal,
      ids,
    );
    const second = await readOwnedBoundParentRows(
      operation,
      f.storage,
      signal,
      ids,
    );
    expect(first?.rows?.map(row => row?.id)).toEqual(ids);
    expect(second?.rows?.map(row => row?.id)).toEqual(ids);
    expect(roots.counts).toEqual([...ids, ...ids]);
    expect(rootDecodes()).toBe(4);
    const publicRows = await operation.readMany([id, id]);
    expect(publicRows[0]).not.toBe(publicRows[1]);
    expect(rootDecodes()).toBe(6);
  } finally {
    decode.mockRestore();
    roots.restore();
    operation.dispose();
    f.close();
  }
});

test.each(['root-corruption', 'row-identity', 'ancestor-tombstone'] as const)(
  'a prior successful decode never masks a late %s in the same SQLite transaction',
  async mutation => {
    const f = await fixture();
    const signal = new AbortController().signal;
    const operation = f.storage.beginReadOperation(signal)!;
    const id = f.parent.id;
    const roots = f.observeRoots(
      new Set([id]),
      async (_id, ordinal) => {
        if (ordinal !== 1) return;
        if (mutation === 'root-corruption')
          await f.database.execute(
            'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
            ['{', id],
          );
        if (mutation === 'row-identity')
          await f.database.execute(
            'UPDATE conversation_artifacts SET created_at = ? WHERE id = ?',
            ['2026-11-02T00:00:00.000Z', id],
          );
      },
      async (sql, parameters) => {
        // After the first ancestor passed, both root SELECTs still read equal bytes.
        if (
          mutation === 'ancestor-tombstone' &&
          roots.counts.length === 1 &&
          sql.startsWith(
            'SELECT a.id, a.session_id, a.created_at, a.result_json',
          ) &&
          parameters?.[0] === id
        )
          await f.database.execute(
            'INSERT INTO conversation_invalid_parents(id) VALUES (?)',
            ['turn-1'],
          );
      },
    );
    try {
      const result = await readOwnedBoundParentRows(
        operation,
        f.storage,
        signal,
        [id, id],
      );
      expect(result?.rows?.[0]?.id).toBe(id);
      expect(result?.rows?.[1]).toBeNull();
      expect(result?.tokens?.[1]).toBeUndefined();
      expect(roots.counts).toEqual([id, id]);
    } finally {
      roots.restore();
      operation.dispose();
      f.close();
    }
  },
);
