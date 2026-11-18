import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openOpSqliteFileQueue } from '../../aiFeatures/integration/testSupport/opSqliteFileQueueFixture';
import { ensureHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { loadOverviewMetrics } from './metricLoader';
const now = new Date('2026-01-15T12:00:00Z');

async function fixture() {
  const f = openOpSqliteFileQueue();
  await runMigrations(f.database);
  await ensureHealthContextGeneration(f.database);
  const records = createRecordRepository(f.database);
  await records.put(
    'health_observation',
    healthObservation('cancel-source', 'heart_rate', '2026-01-14T12:00:00Z'),
  );
  return { ...f, records };
}

test('already-aborted overview performs no database work', async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  const database = {
    execute: jest.fn(f.database.execute),
    transaction: jest.fn(f.database.transaction),
  };
  try {
    await expect(
      loadOverviewMetrics(database, now, controller.signal),
    ).rejects.toThrow('cancelled');
    expect(database.execute).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

test.each(['setup', 'aggregate'] as const)(
  'aborting during %s commits interleaved DELETE without publishing',
  async boundary => {
    const f = await fixture();
    const controller = new AbortController();
    let injected = false;
    const afterAbort: string[] = [];
    const database: SqlDatabase = {
      ...f.database,
      transaction: work =>
        f.database.transaction(tx =>
          work({
            ...tx,
            execute: async (query, bindings) => {
              const result = await tx.execute(query, bindings);
              if (injected) afterAbort.push(query);
              const target =
                boundary === 'setup'
                  ? query.startsWith(
                      'INSERT OR IGNORE INTO health_context_generation',
                    )
                  : /\bWITH\s+days\s*\(/i.test(query);
              if (!injected && target) {
                injected = true;
                await f.database.execute(
                  "DELETE FROM health_observations WHERE id='cancel-source'",
                );
                controller.abort();
              }
              return result;
            },
          }),
        ),
    };
    try {
      await expect(
        loadOverviewMetrics(database, now, controller.signal),
      ).rejects.toThrow('cancelled');
      expect(injected).toBe(true);
      expect(
        await f.records.get('health_observation', 'cancel-source'),
      ).toBeNull();
      if (boundary === 'setup') {
        expect(
          afterAbort.some(query =>
            query.includes('health_context_staleness_delete'),
          ),
        ).toBe(true);
        expect(
          afterAbort.some(query => /\bWITH\s+days\s*\(/i.test(query)),
        ).toBe(false);
      } else expect(afterAbort).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

test.each(['setup', 'aggregate'] as const)(
  'SQL failure during %s wins over cancellation and preserves rollback',
  async boundary => {
    const f = await fixture();
    const controller = new AbortController();
    const failure = new Error('Synthetic SQL execution failed');
    let injected = false;
    const database: SqlDatabase = {
      ...f.database,
      transaction: work =>
        f.database.transaction(tx =>
          work({
            ...tx,
            execute: async (query, bindings) => {
              const target =
                boundary === 'setup'
                  ? query.startsWith(
                      'INSERT OR IGNORE INTO health_context_generation',
                    )
                  : /\bWITH\s+days\s*\(/i.test(query);
              if (!injected && target) {
                injected = true;
                await f.database.execute(
                  "DELETE FROM health_observations WHERE id='cancel-source'",
                );
                controller.abort();
                throw failure;
              }
              return tx.execute(query, bindings);
            },
          }),
        ),
    };
    try {
      await expect(
        loadOverviewMetrics(database, now, controller.signal),
      ).rejects.toBe(failure);
      expect(injected).toBe(true);
      expect(
        (await f.records.get('health_observation', 'cancel-source'))?.id,
      ).toBe('cancel-source');
    } finally {
      await f.close();
    }
  },
);

test('normal results are unchanged and cancellation after commit cannot publish', async () => {
  const f = await fixture();
  const controller = new AbortController();
  try {
    const expected = await loadOverviewMetrics(f.database, now);
    expect(
      await loadOverviewMetrics(f.database, now, controller.signal),
    ).toEqual(expected);
    const database: SqlDatabase = {
      ...f.database,
      async transaction(work) {
        await f.database.transaction(work);
        controller.abort();
      },
    };
    await expect(
      loadOverviewMetrics(database, now, controller.signal),
    ).rejects.toThrow('cancelled');
    expect(
      (await f.records.get('health_observation', 'cancel-source'))?.id,
    ).toBe('cancel-source');
  } finally {
    await f.close();
  }
});
