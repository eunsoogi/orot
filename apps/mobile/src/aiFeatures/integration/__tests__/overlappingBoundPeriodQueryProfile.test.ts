import type { SqlExecutor } from '@orot/storage';
import { gate } from '../testSupport/boundConversationDigestFixture';
import { readOwnedBoundParentRows } from '../../../storage/conversationArtifactRead';
import * as reader from '../../../healthEvidence/healthContext/reader';
import {
  assertSameConnectionQuantityFence,
  boundPeriodSqlFamily,
  overlappingBoundPeriodFixture,
} from '../testSupport/overlappingBoundPeriodQueryFixture';

test.each([
  'dense',
  'sparse',
  'restored-old-engine',
  'restored-no-cover',
] as const)(
  'pairs published and candidate on cold owned report windows: %s',
  async dataset => {
    const { f, ranges, signal } = await overlappingBoundPeriodFixture(
      dataset === 'dense' ? undefined : 2,
    );
    if (dataset === 'restored-no-cover')
      await f.database.execute(
        'DROP INDEX IF EXISTS health_context_observation_covering',
      );
    const realRead = reader.readHealthContextReport;
    const transaction = f.database.transaction.bind(f.database);
    let stats: Record<string, { calls: number; wall: number }> = {};
    let calculated: Awaited<ReturnType<typeof realRead>>[] = [];
    let mode: 'published' | 'candidate' = 'published';
    let versionCalls = 0;
    let indexedCount = 0;
    let chosen:
      { sql: string; args?: Parameters<SqlExecutor['execute']>[1] } | undefined;
    let stockQuery: typeof chosen;
    const release = jest
      .spyOn(reader, 'readHealthContextReport')
      .mockImplementation(async (...args) => {
        if (mode === 'published') args[7] = undefined;
        const value = await realRead(...args);
        calculated.push(value);
        return value;
      });
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = async (sql, args) => {
          if (sql === 'SELECT sqlite_version() AS version') {
            versionCalls++;
            if (dataset === 'restored-old-engine')
              return { rows: [{ version: '3.43.2' }] };
          }
          const k = boundPeriodSqlFamily(sql);
          if (k === 'quantity') {
            if (sql.includes('sum(amount ORDER BY')) {
              indexedCount++;
              chosen ??= { sql, args };
            } else if (mode === 'published' && args?.length === 4)
              stockQuery ??= { sql, args };
          }
          const start = performance.now();
          try {
            return await execute(sql, args);
          } finally {
            const m = (stats[k] ??= { calls: 0, wall: 0 });
            m.calls++;
            m.wall += performance.now() - start;
          }
        };
        await work(tx);
      });
    try {
      const ids = ranges.map(value => value.id);
      const results = [];
      for (const path of [
        'published',
        'candidate',
        'candidate',
        'published',
      ] as const) {
        mode = path;
        stats = {};
        calculated = [];
        versionCalls = 0;
        indexedCount = 0;
        const operation = f.storage.beginReadOperation(signal)!;
        const started = performance.now();
        try {
          const result = await readOwnedBoundParentRows(
            operation,
            f.storage,
            signal,
            ids,
          );
          const timing = {
            dataset,
            path,
            wall: performance.now() - started,
            versions: versionCalls,
            indexedCount,
            queries: stats,
          };
          console.info('OVERLAPPING_BOUND_PERIOD', JSON.stringify(timing));
          expect(result?.rows?.map(value => value?.id)).toEqual(ids);
          expect(calculated).toHaveLength(18);
          expect(versionCalls).toBe(path === 'candidate' ? 1 : 0);
          expect(indexedCount).toBe(
            path === 'candidate' && dataset !== 'restored-old-engine' ? 5 : 0,
          );
          expect(stats.quantity?.calls).toBe(12);
          expect(stats.heart?.calls).toBe(6);
          expect(stats.heartPrefixSetupCleanup).toBeUndefined();
          const leftovers = await f.database.execute(
            "SELECT name FROM sqlite_temp_schema WHERE name='orot_heart_workout_prefix'",
          );
          expect(leftovers.rows).toEqual([]);
          results.push({ rows: result?.rows, calculated });
        } finally {
          operation.dispose();
        }
      }
      for (const result of results.slice(1)) expect(result).toEqual(results[0]);
      if (dataset === 'dense' || dataset === 'restored-no-cover') {
        expect(chosen).toBeDefined();
        const plan = async (query: NonNullable<typeof chosen>) =>
          (
            await f.database.execute(
              'EXPLAIN QUERY PLAN ' + query.sql,
              query.args,
            )
          ).rows.map(row => String(row.detail));
        const candidate = await plan(chosen!);
        const control = await plan(stockQuery!);
        console.info(
          'OVERLAPPING_BOUND_PERIOD_PLAN',
          JSON.stringify({ dataset, candidate, control }),
        );
        expect(
          candidate.some(line => line.includes('CORRELATED SCALAR SUBQUERY')),
        ).toBe(true);
        expect(
          candidate.some(line =>
            /SEARCH r USING (?:COVERING )?INDEX health_context_observation_(?:time|covering)/.test(
              line,
            ),
          ),
        ).toBe(true);
        expect(candidate.some(line => line === 'SCAN r')).toBe(false);
      }
    } finally {
      release.mockRestore();
      f.close();
    }
  },
  70_000,
);

test.each(['replace', 'delete', 'revoke'] as const)(
  'scoped quantity index preserves same-connection %s fences',
  async effect => {
    await assertSameConnectionQuantityFence(effect);
  },
  30_000,
);

test('revoked canonical reader cannot select indexed quantities after capability await', async () => {
  const { f, signal } = await overlappingBoundPeriodFixture(2);
  const operation = f.storage.beginReadOperation(signal)!;
  const started = gate();
  const resume = gate();
  let held = false;
  let usedIndex = false;
  const transaction = f.database.transaction.bind(f.database);
  f.database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (sql, args) => {
        const result = await execute(sql, args);
        if (!held && sql === 'SELECT sqlite_version() AS version') {
          held = true;
          started.release();
          await resume.wait;
        }
        if (sql.includes('sum(amount ORDER BY')) usedIndex = true;
        return result;
      };
      await work(tx);
    });
  const reading = readOwnedBoundParentRows(operation, f.storage, signal, [
    'overlap-3',
  ])!;
  try {
    await Promise.race([started.wait, reading]);
    expect(held).toBe(true);
    operation.readMany = async () => [];
    resume.release();
    const result = await reading;
    expect(result?.tokens).toBeUndefined();
    expect(usedIndex).toBe(false);
    await expect(
      readOwnedBoundParentRows(operation, f.storage, signal, ['overlap-3']),
    ).resolves.toBeUndefined();
  } finally {
    resume.release();
    await reading.catch(() => {});
    operation.dispose();
    f.close();
  }
}, 15000);
