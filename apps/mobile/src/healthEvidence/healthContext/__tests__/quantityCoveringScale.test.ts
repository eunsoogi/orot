import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';
import { ensureHealthContextGeneration } from '../generation';
const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

/** A real file database exposes payload lookup costs that a tiny memory fixture
 * misses. No timing threshold: exact output and the covering VM are the oracle.
 * All records and large metadata are synthetic; batching bounds seed memory. */
test('quantity reads cover large payloads without changing floating totals or family admission', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quantity-covering-'));
  const f = openSqliteTestDatabase(join(directory, 'synthetic.sqlite'));
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    for (let batch = 0; batch < 100; batch++) {
      const records = Array.from({ length: 1000 }, (_, offset) => {
        const i = batch * 1000 + offset;
        const at = new Date(
          Date.UTC(2023, 0, 1) + Math.floor(i / 2) * 60000,
        ).toISOString();
        return {
          ...healthObservation(
            `scale-${i}`,
            i % 2 ? 'heart_rate' : 'step_count',
            at,
          ),
          value: {
            kind: 'quantity',
            amount: i % 3 ? 0.1 : 100000.0000001,
            unit: 'count',
          },
          padding: 'x'.repeat(4096),
        };
      });
      await f.database.execute(
        `INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.effectiveAt'),json_extract(value,'$.effectiveAt'),json_extract(value,'$.ingestedAt'),value FROM json_each(?)`,
        [JSON.stringify(records)],
      );
    }
    const root = (
      await f.database.execute(
        "SELECT rootpage FROM sqlite_schema WHERE type = 'table' AND name = 'health_observations'",
      )
    ).rows[0]!.rootpage;
    for (const family of ['all', 'activity', 'measurements'] as const) {
      const result = await readHealthQuantityContext(
        {
          execute: async (query, parameters) => {
            const baseline = query.replace(
              'health_observations r',
              'health_observations r INDEXED BY health_context_observation_time',
            );
            const expected = await f.database.execute(baseline, parameters);
            const actual = await f.database.execute(query, parameters);
            expect(actual).toEqual(expected);
            const plan = await f.database.execute(
              'EXPLAIN QUERY PLAN ' + query,
              parameters,
            );
            // Activity retains its lower(concept)-leading narrow index. Only
            // generic/measurement reads claim payload-free covering here.
            if (family !== 'activity')
              expect(
                plan.rows.some(row =>
                  String(row.detail).includes('SEARCH r USING COVERING INDEX'),
                ),
              ).toBe(true);
            const vm = await f.database.execute('EXPLAIN ' + query, parameters);
            const tableCursors = new Set(
              vm.rows
                .filter(row => row.opcode === 'OpenRead' && row.p2 === root)
                .map(row => row.p1),
            );
            if (family !== 'activity')
              expect(
                vm.rows.filter(
                  row => row.opcode === 'Column' && tableCursors.has(row.p1),
                ),
              ).toEqual([]);
            return actual;
          },
        },
        healthContextDays({
          fromInclusive: '2023-01-01T00:00:00Z',
          toExclusive: '2024-01-01T00:00:00Z',
          timeZone: 'UTC',
        }),
        undefined,
        family,
        '2027-01-01T00:00:00Z',
      );
      expect(result.truncated).toBe(false);
      expect(
        result.series
          .flatMap(series => series.days)
          .reduce((total, day) => total + day.samples, 0),
      ).toBe(family === 'all' ? 100000 : 50000);
    }
  } finally {
    f.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);
