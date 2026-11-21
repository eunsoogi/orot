import { readOwnedBoundParentRows } from '../../../storage/conversationArtifactRead';
import type { ConversationArtifact } from '../../../storage/conversationArtifactCodec';
import * as evidence from '../evidenceUtils';
import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';

// These rows exercise real saved SQLite snapshots and parent joins. Only the
// digest function is observed, never stubbed or substituted for its result.
async function fixture() {
  const f = await quarantinedHistoryFixture();
  const base = (await f.storage.read('newer'))!;
  const put = async (
    id: string,
    parent?: ConversationArtifact,
    large = false,
  ) => {
    const revision = parent ? evidence.fingerprint(parent) : '';
    const reference = {
      sourceKind: 'generated_artifact' as const,
      sourceId: parent?.id ?? '',
      evidenceId: parent?.id ?? '',
      sourceRevision: revision,
      evidenceRevision: revision,
      locator: { kind: 'generated_artifact', type: 'conversation_turn' },
      effectiveTime: null,
      reviewState: 'unreviewed' as const,
    };
    const row: ConversationArtifact = {
      ...base,
      id,
      ...(large
        ? {
            priorDialogue: Array.from({ length: 3000 }, (_, i) => ({
              question: `Synthetic question ${i}`,
              answer: `Synthetic answer ${i}`,
            })),
          }
        : {}),
      sources: parent
        ? [
            {
              kind: 'generated_conversation',
              id: parent.id,
              revision,
              reference,
            },
          ]
        : [],
      citations: parent ? [reference] : [],
    };
    await f.storage.append(row);
    return row;
  };
  const leaf = await put('leaf');
  for (const name of ['a', 'b']) {
    const heavy = await put(`heavy-${name}`, leaf, true);
    const branch = await put(`branch-${name}`, heavy);
    await put(`root-${name}`, branch);
  }
  const tx = f.database.transaction.bind(f.database);
  const trace: [string, readonly unknown[] | undefined][] = [];
  let matchingRows = 0;
  let alter: 'delete' | 'corrupt' | undefined;
  f.database.transaction = operation =>
    tx(async executor => {
      const execute = executor.execute.bind(executor);
      await operation({
        ...executor,
        execute: async (sql, args) => {
          trace.push([sql, args]);
          if (
            alter &&
            sql.includes(
              'SELECT a.result_json, a.id, a.session_id, a.created_at',
            ) &&
            args?.[0] === (alter === 'delete' ? 'leaf' : 'heavy-a') &&
            ++matchingRows === 2
          ) {
            // The second root has already been read; deletion from SQLite
            // must still prevent a previously hashed ancestor from publishing.
            if (alter === 'delete')
              await execute('DELETE FROM conversation_artifacts WHERE id = ?', [
                'leaf',
              ]);
            if (alter === 'corrupt')
              await execute(
                'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
                ['{invalid json', 'heavy-a'],
              );
          }
          return execute(sql, args);
        },
      });
    });
  const owned = async (ids: string[]) => {
    const signal = new AbortController().signal;
    const op = f.storage.beginReadOperation(signal, { historyPage: true })!;
    try {
      return (await readOwnedBoundParentRows(op, f.storage, signal, ids))?.rows;
    } finally {
      op.dispose();
    }
  };
  const reset = (mutation?: typeof alter) => {
    alter = mutation;
    matchingRows = 0;
    trace.length = 0;
  };
  return { ...f, trace, reset, owned };
}

test.each([
  ['repeated', ['root-a', 'root-a', 'root-a'], 1],
  ['alternating', ['root-a', 'root-b', 'root-a'], 3],
] as const)(
  '%s deep parents preserve SQL and returned snapshots',
  async (_, input, expected) => {
    const f = await fixture();
    const calls = jest.spyOn(evidence, 'fingerprint');
    const counts = () =>
      calls.mock.calls.filter(([value]) =>
        ['heavy-a', 'heavy-b'].includes((value as ConversationArtifact).id),
      ).length;
    try {
      const ids = [...input];
      const strict = await f.storage.readMany(ids);
      const strictTrace = [...f.trace];
      expect(strict.every(Boolean)).toBe(true);
      expect(counts()).toBe(ids.length);
      f.reset();
      calls.mockClear();
      expect(await f.owned(ids)).toEqual(strict);
      expect(f.trace).toEqual(strictTrace);
      expect(counts()).toBe(expected);
      f.reset();
      calls.mockClear();
      expect(await f.owned(ids)).toEqual(strict);
      expect(counts()).toBe(expected);
    } finally {
      calls.mockRestore();
      f.close();
    }
  },
);

test.each(['delete', 'corrupt'] as const)(
  'bound repeats refuse a late %s of a descendant',
  async mutation => {
    const f = await fixture();
    try {
      if (mutation === 'corrupt') {
        // Simulate damaged on-disk bytes rather than the normal update API:
        // the invalid raw row must reach the decoder, not only the trigger.
        await f.database.execute('DROP TRIGGER conversation_parent_update');
      }
      f.reset(mutation);
      const rows = await f.owned(['root-a', 'root-a', 'newer']);
      expect(rows?.map(row => row?.id ?? null)).toEqual([
        'root-a',
        null,
        'newer',
      ]);
      expect(
        f.trace.filter(
          ([sql, args]) =>
            sql.includes(
              'SELECT a.result_json, a.id, a.session_id, a.created_at',
            ) && args?.[0] === (mutation === 'delete' ? 'leaf' : 'heavy-a'),
        ),
      ).toHaveLength(2);
      const selected = await f.database.execute(
        'SELECT result_json FROM conversation_artifacts WHERE id = ?',
        [mutation === 'delete' ? 'leaf' : 'heavy-a'],
      );
      expect(selected.rows.map(row => row.result_json)).toEqual(
        mutation === 'delete' ? [] : ['{invalid json'],
      );
    } finally {
      f.close();
    }
  },
);
