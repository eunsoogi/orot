import { actualSendRetentionFixture } from '../../aiFeatures/integration/testSupport/actualSendRetentionFixture';
import { readOwnedBoundParentRows } from '../conversationArtifactRead';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import {
  acquireProtectedReadEpoch,
  guardedNativeDatabase,
} from '../protectedReadEpoch';

const probe = 'SELECT total_changes() AS local, schema_version, data_version';
const marker = 'linked_ids(id) AS (';

test('structural distinct roots match stock rows and run each unique root through every fence', async () => {
  const { f } = await actualSendRetentionFixture('nested-distinct-six');
  const original = f.database.transaction.bind(f.database);
  const metrics = { all: 0, generation: 0, marker: 0 };
  f.database.transaction = work =>
    original(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = (sql, binds) => {
        metrics.all++;
        if (sql.includes(marker)) metrics.marker++;
        if (
          sql.includes(
            'SELECT mutations, deletions FROM health_context_generation',
          )
        )
          metrics.generation++;
        return execute(sql, binds);
      };
      await work(tx);
    });
  const guarded = createConversationArtifactStorage(
    guardedNativeDatabase(f.database),
  );
  const signal = new AbortController().signal;
  const ids = Array.from({ length: 48 }, (_, i) =>
    i % 2 ? 'direct-4' : 'direct-5',
  );
  const read = async (storage: typeof f.storage, roots = ids) => {
    const operation = storage.beginReadOperation(signal, {
      rollbackOnFailure: true,
    })!;
    try {
      return (
        await readOwnedBoundParentRows(
          operation,
          storage,
          signal,
          roots,
          'initial',
        )
      )?.rows;
    } finally {
      operation.dispose();
    }
  };
  try {
    await guarded.currentGeneration();
    const first = await read(f.storage);
    const control = { ...metrics };
    Object.assign(metrics, { all: 0, generation: 0, marker: 0 });
    await read(f.storage, [...new Set(ids)]);
    const unique = { ...metrics };
    Object.assign(metrics, { all: 0, generation: 0, marker: 0 });
    const second = await read(guarded);
    expect(second).toEqual(first);
    expect(second).toHaveLength(48);
    expect(metrics.generation).toBeGreaterThan(0);
    expect(metrics.generation).toBeLessThanOrEqual(unique.generation);
    expect(metrics.marker).toBeLessThanOrEqual(unique.marker);
    expect(metrics.all).toBeLessThanOrEqual(unique.all + 2);
    expect(second?.map(row => row?.id)).toEqual(ids);
    expect(metrics.marker).toBeLessThan(control.marker / 10);
    expect(metrics.all).toBeLessThan(control.all / 2);
    console.info(
      'BOUND_WITNESS_SQLITE',
      JSON.stringify({ control, guarded: metrics }),
    );
  } finally {
    f.close();
  }
});

test.each(['delete', 'marker', 'savepoint'] as const)(
  'live same-connection %s refuses structural candidates and retries stock',
  async effect => {
    const { f } = await actualSendRetentionFixture('nested-distinct-six');
    const original = f.database.transaction.bind(f.database);
    const database = guardedNativeDatabase(f.database);
    const storage = createConversationArtifactStorage(database);
    await storage.currentGeneration();
    let probes = 0;
    let mutated = false;
    let needsControl = effect === 'savepoint';
    f.database.transaction = work =>
      original(async tx => {
        const execute = tx.execute.bind(tx);
        if (needsControl) {
          needsControl = false;
          await execute('SAVEPOINT synthetic_before_witness');
          // Hide a known descendant before the witness; resolving the savepoint
          // later changes visible rows without advancing SQLite total_changes.
          await execute(
            'UPDATE conversation_artifacts SET result_json=? WHERE id=?',
            ['invalid', 'direct-0'],
          );
        }
        tx.execute = async (sql, binds) => {
          if (sql.startsWith(probe) && ++probes === 2 && !mutated) {
            mutated = true;
            if (effect === 'delete')
              await execute('DELETE FROM health_observations WHERE id=?', [
                f.inside.id,
              ]);
            else if (effect === 'marker')
              await execute(
                'INSERT INTO agent_memory_removed_sources VALUES (?)',
                [f.inside.id],
              );
            else await database.execute('ROLLBACK TO synthetic_before_witness');
          }
          return execute(sql, binds);
        };
        await work(tx);
      });
    const signal = new AbortController().signal;
    const op = storage.beginReadOperation(signal, { rollbackOnFailure: true })!;
    try {
      const ids = ['direct-5', 'direct-5', 'direct-5'];
      const result = await readOwnedBoundParentRows(
        op,
        storage,
        signal,
        ids,
        'initial',
      );
      console.info('WITNESS_CONTROL', effect, probes, mutated);
      expect(mutated).toBe(true);
      expect(probes).toBe(2);
      if (effect === 'savepoint')
        expect(result?.rows?.every(row => row?.id === 'direct-5')).toBe(true);
      else expect(result?.rows).toEqual([null, null, null]);
      const records = await f.database.execute(
        'SELECT id FROM health_observations WHERE id=?',
        [f.inside.id],
      );
      expect(records.rows).toEqual(
        effect === 'delete' ? [] : [{ id: f.inside.id }],
      );
    } finally {
      op.dispose();
      f.close();
    }
  },
);

test('an unsafe native call pending before acquire stays out of the structural plan', async () => {
  const { f } = await actualSendRetentionFixture('nested-distinct-six');
  try {
    const execute = f.database.execute.bind(f.database);
    let resume!: () => void;
    const blocked = new Promise<void>(done => {
      resume = done;
    });
    f.database.execute = async (sql, binds) => {
      if (sql === 'SAVEPOINT pending_test') await blocked;
      return execute(sql, binds);
    };
    const scoped = guardedNativeDatabase(f.database);
    const mutation = scoped.execute('SAVEPOINT pending_test');
    try {
      expect(acquireProtectedReadEpoch(scoped)).toBeUndefined();
    } finally {
      resume();
      await mutation;
    }
    await scoped.execute('RELEASE pending_test');
    const next = acquireProtectedReadEpoch(scoped);
    expect(next?.current()).toBe(true);
    next?.dispose();
  } finally {
    f.close();
  }
});
