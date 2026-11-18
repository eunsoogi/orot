import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createHealthContextReader } from '../reader';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-02T00:00:00Z',
  timeZone: 'UTC',
};
async function fixture() {
  const f = openSqliteTestDatabase(':memory:');
  await runMigrations(f.database);
  const records = createRecordRepository(f.database);
  await records.put(
    'health_observation',
    healthObservation('sample', 'heart_rate', '2026-10-01T10:00:00Z'),
  );
  return { ...f, records };
}

/** Real SQLite generations, not a generic-reader validity cache. */
test('reuses all exact windows only within its owner and releases escaped readers', async () => {
  const f = await fixture(),
    other = await fixture();
  try {
    const base = createHealthContextReader(f.database);
    expect(
      beginHealthContextReadOperation(async () => {
        throw new Error('custom');
      }),
    ).toBeUndefined();
    const operation = beginHealthContextReadOperation(base)!;
    const calls: string[] = [];
    const trace = (step: string, status: string) => {
      if (step === 'quantities' && status === 'started') calls.push(step);
    };
    for (let repeat = 0; repeat < 2; repeat++)
      for (let i = 0; i < 7; i++)
        await operation.read(
          {
            ...window,
            toExclusive: new Date(Date.UTC(2026, 9, 2 + i)).toISOString(),
          },
          ['measurements'],
          undefined,
          trace,
        );
    expect(calls).toHaveLength(7);
    const baseline = await operation.read(window, ['measurements']);
    await other.records.delete('health_observation', 'sample');
    expect(await operation.read(window, ['measurements'])).toEqual(baseline);
    const foreign = beginHealthContextReadOperation(
      createHealthContextReader(other.database),
    )!;
    expect((await foreign.read(window, ['measurements'])).quantities).toEqual(
      [],
    );
    foreign.dispose();
    await f.records.delete('health_observation', 'sample');
    expect(
      (await operation.read(window, ['measurements'], undefined, trace))
        .quantities,
    ).toEqual([]);
    operation.dispose();
    await operation.read(window, ['measurements'], undefined, trace);
    expect(calls).toHaveLength(9); // Seven distinct windows, deletion, then released base reader.
  } finally {
    f.close();
    other.close();
  }
});

test('rejects cancellation even on a cache hit after the generation await', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    let abort = false;
    const database: SqlDatabase = {
      ...f.database,
      transaction: op => f.database.transaction(op),
      execute: async (q, p) => {
        const result = await f.database.execute(q, p);
        if (abort && q.startsWith('SELECT mutations')) controller.abort();
        return result;
      },
    };
    const op = beginHealthContextReadOperation(
      createHealthContextReader(database),
    )!;
    await op.read(window, ['measurements']);
    abort = true;
    await expect(
      op.read(window, ['measurements'], controller.signal),
    ).rejects.toThrow('cancelled');
    abort = false;
    expect(
      (await op.read(window, ['measurements'])).quantities.length,
    ).toBeGreaterThan(0);
    op.dispose();
  } finally {
    f.close();
  }
});

test('rolled-back aggregates cannot become a later equal-generation cache hit', async () => {
  const f = await fixture();
  try {
    let rollback = false;
    const database: SqlDatabase = {
      execute: (q, p) => f.database.execute(q, p),
      transaction: operation =>
        f.database.transaction(async tx => {
          if (rollback) await tx.execute('DELETE FROM health_observations');
          await operation(tx);
          if (rollback) throw new Error('Synthetic rollback after aggregate');
        }),
    };
    const base = createHealthContextReader(database);
    await base(window, ['measurements']);
    const op = beginHealthContextReadOperation(base)!;
    const uncached = { ...window, toExclusive: '2026-10-03T00:00:00Z' };
    rollback = true;
    await expect(op.read(uncached, ['measurements'])).rejects.toThrow(
      'Synthetic rollback',
    );
    rollback = false;
    // Reach the same counter previously observed inside the rolled-back transaction,
    // but with a different committed dataset. Reusing that uncommitted report loses the row.
    await f.records.put(
      'health_observation',
      healthObservation('second', 'heart_rate', '2026-10-01T11:00:00Z'),
    );
    expect(
      (await op.read(uncached, ['measurements'])).quantities[0]?.days[0]
        ?.samples,
    ).toBe(2);
    op.dispose();
  } finally {
    f.close();
  }
});

test('mutation during aggregation, commit-time mutation and read errors do not populate the cache', async () => {
  const f = await fixture();
  try {
    let mode: 'none' | 'inside' | 'commit' | 'error' = 'none';
    let armed = false;
    const database: SqlDatabase = {
      execute: async (q, p) => {
        if (mode === 'error' && q.startsWith('SELECT mutations'))
          throw new Error('Synthetic read error');
        return f.database.execute(q, p);
      },
      transaction: async operation => {
        await f.database.transaction(async tx => {
          await operation({
            ...tx,
            execute: async (q, p) => {
              const result = await tx.execute(q, p);
              if (
                mode === 'inside' &&
                armed &&
                q.includes('observations AS MATERIALIZED')
              ) {
                armed = false;
                // Inject on the same SQLite connection, as a native direct write can interleave.
                await tx.execute('DELETE FROM health_observations');
              }
              return result;
            },
          });
        });
        if (mode === 'commit' && armed) {
          armed = false;
          await f.database.execute('DELETE FROM health_observations');
        }
      },
    };
    const base = createHealthContextReader(database);
    await base({ ...window, toExclusive: '2026-10-03T00:00:00Z' }, [
      'measurements',
    ]);
    const op = beginHealthContextReadOperation(base)!;
    mode = 'inside';
    armed = true;
    await expect(op.read(window, ['measurements'])).rejects.toThrow(
      'changed during',
    );
    expect(await f.records.get('health_observation', 'sample')).toBeNull();
    await f.records.put(
      'health_observation',
      healthObservation('sample', 'heart_rate', '2026-10-01T10:00:00Z'),
    );
    mode = 'error';
    await expect(op.read(window, ['measurements'])).rejects.toThrow(
      'Synthetic read error',
    );
    mode = 'commit';
    armed = true;
    await expect(op.read(window, ['measurements'])).rejects.toThrow(
      'changed before publication',
    );
    mode = 'none';
    expect((await op.read(window, ['measurements'])).quantities).toEqual([]);
    op.dispose();
  } finally {
    f.close();
  }
});

test('owner cancellation applies to signal-less aliases, while disposed aliases use the base reader', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    let cancel = false;
    const database: SqlDatabase = {
      transaction: operation => f.database.transaction(operation),
      execute: async (query, args) => {
        const result = await f.database.execute(query, args);
        if (cancel && query.startsWith('SELECT mutations')) controller.abort();
        return result;
      },
    };
    const operation = beginHealthContextReadOperation(
      createHealthContextReader(database),
      controller.signal,
    )!;
    await operation.read(window, ['measurements']);
    cancel = true;
    await expect(operation.read(window, ['measurements'])).rejects.toThrow(
      'cancelled',
    );
    operation.dispose();
    expect(
      (await operation.read(window, ['measurements'])).quantities,
    ).toHaveLength(1);
  } finally {
    f.close();
  }
});
