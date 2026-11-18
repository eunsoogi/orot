import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createLocalEvidenceData } from '../../localEvidenceData';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-02T00:00:00Z',
  timeZone: 'UTC',
};
async function fixture() {
  const f = openSqliteTestDatabase(':memory:');
  await runMigrations(f.database);
  await createRecordRepository(f.database).put(
    'health_observation',
    healthObservation('sample', 'heart_rate', '2026-10-01T10:00:00Z'),
  );
  return f;
}

/** Adapter identity must not trade away private temporary storage or readiness retry. */
test('production reader propagates preparation failure and retries before aggregation', async () => {
  const f = await fixture();
  try {
    let attempts = 0;
    const failure = new Error('synthetic preparation failure');
    const database: SqlDatabase = {
      ...f.database,
      execute: async (sql, params) => {
        if (sql === 'PRAGMA temp_store = MEMORY' && ++attempts === 1)
          throw failure;
        return f.database.execute(sql, params);
      },
    };
    const read = createLocalEvidenceData(database).readHealthContext!;
    const trace = jest.fn();
    await expect(read(window, ['measurements'], undefined, trace)).rejects.toBe(
      failure,
    );
    expect(trace).not.toHaveBeenCalledWith('quantities', 'started');
    const report = await read(window, ['measurements'], undefined, trace);
    expect(attempts).toBe(2);
    expect(report.quantities).toHaveLength(1);
    expect(trace).toHaveBeenCalledWith('quantities', 'started');
    expect(
      (await f.database.execute('PRAGMA temp_store')).rows[0]?.temp_store,
    ).toBe(2);
  } finally {
    f.close();
  }
});

// The await boundary represents a pending native preparation, not synchronous SQL cancellation.
test.each(['caller', 'operation'] as const)(
  'production reader stops before aggregation when %s cancels during preparation',
  async owner => {
    const f = await fixture();
    try {
      const controller = new AbortController();
      let prepareStarted!: () => void;
      const started = new Promise<void>(resolve => {
        prepareStarted = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const database: SqlDatabase = {
        ...f.database,
        execute: async (sql, params) => {
          if (sql === 'PRAGMA temp_store = MEMORY') {
            prepareStarted();
            await gate;
          }
          return f.database.execute(sql, params);
        },
      };
      const base = createLocalEvidenceData(database).readHealthContext!;
      const operation = beginHealthContextReadOperation(
        base,
        owner === 'operation' ? controller.signal : undefined,
      )!;
      const trace = jest.fn();
      const pending = operation.read(
        window,
        ['measurements'],
        owner === 'caller' ? controller.signal : undefined,
        trace,
      );
      await started;
      controller.abort();
      release();
      await expect(pending).rejects.toThrow('cancelled');
      expect(trace).not.toHaveBeenCalledWith('quantities', 'started');
      operation.dispose();
      expect((await base(window, ['measurements'])).quantities).toHaveLength(1);
    } finally {
      f.close();
    }
  },
);
