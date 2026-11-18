import { runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createHealthContextReader } from '../reader';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-02T00:00:00Z',
  timeZone: 'UTC',
};

test('cancelled aggregate is not reused on the next successful read', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const operation = beginHealthContextReadOperation(
      createHealthContextReader(f.database),
    )!;
    const controller = new AbortController();
    let queries = 0;
    await expect(
      operation.read(
        window,
        ['measurements'],
        controller.signal,
        (step, status) => {
          if (step === 'quantities' && status === 'started') queries++;
          if (step === 'quantities' && status === 'completed')
            controller.abort();
        },
      ),
    ).rejects.toThrow('cancelled');
    await operation.read(
      window,
      ['measurements'],
      undefined,
      (step, status) => {
        if (step === 'quantities' && status === 'started') queries++;
      },
    );
    expect(queries).toBe(2);
    operation.dispose();
  } finally {
    f.close();
  }
});

test('release during an outstanding transaction does not preserve a late scoped entry', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    let hold = false;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const database: SqlDatabase = {
      execute: (query, args) => f.database.execute(query, args),
      transaction: operation =>
        f.database.transaction(async tx => {
          await operation(tx);
          if (hold) {
            entered();
            await gate;
          }
        }),
    };
    const base = createHealthContextReader(database);
    await base(window, ['measurements']);
    const scoped = beginHealthContextReadOperation(base)!;
    const otherWindow = { ...window, toExclusive: '2026-10-03T00:00:00Z' };
    let queries = 0;
    const trace = (step: string, status: string) => {
      if (step === 'quantities' && status === 'started') queries++;
    };
    hold = true;
    const pending = scoped.read(
      otherWindow,
      ['measurements'],
      undefined,
      trace,
    );
    await started;
    scoped.dispose();
    hold = false;
    release();
    await pending;
    await scoped.read(otherWindow, ['measurements'], undefined, trace);
    expect(queries).toBe(2);
  } finally {
    f.close();
  }
});

test.each(['cancel', 'query-error'] as const)(
  'preserves interleaved writes when aggregate fails with %s',
  async mode => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(f.database);
      await f.database.execute(
        'CREATE TABLE synthetic_user_writes(value INTEGER)',
      );
      const controller = new AbortController();
      let armed = false;
      const database: SqlDatabase = {
        execute: (query, args) => f.database.execute(query, args),
        transaction: operation =>
          f.database.transaction(tx =>
            operation({
              ...tx,
              execute: async (query, args) => {
                const result = await tx.execute(query, args);
                if (armed && query.includes('observations AS MATERIALIZED')) {
                  armed = false;
                  await tx.execute(
                    'INSERT INTO synthetic_user_writes VALUES (1)',
                  );
                  if (mode === 'cancel') controller.abort();
                  else throw new Error('Synthetic query failure');
                }
                return result;
              },
            }),
          ),
      };
      const base = createHealthContextReader(database);
      await base({ ...window, toExclusive: '2026-10-03T00:00:00Z' }, [
        'measurements',
      ]);
      const operation = beginHealthContextReadOperation(base)!;
      armed = true;
      await expect(
        operation.read(window, ['measurements'], controller.signal),
      ).rejects.toThrow(
        mode === 'cancel' ? 'cancelled' : 'Synthetic query failure',
      );
      expect(
        (await f.database.execute('SELECT value FROM synthetic_user_writes'))
          .rows,
      ).toEqual([{ value: 1 }]);
      operation.dispose();
    } finally {
      f.close();
    }
  },
);
