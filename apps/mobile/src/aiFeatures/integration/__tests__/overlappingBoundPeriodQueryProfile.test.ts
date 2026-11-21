import type { SqlExecutor } from '@orot/storage';
import { gate } from '../testSupport/boundConversationDigestFixture';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { readOwnedBoundParentRows } from '../../../storage/conversationArtifactRead';
import * as reader from '../../../healthEvidence/healthContext/reader';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { captureConversationSources } from '../captureConversationSources';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';

const day = 86_400_000;
const minute = 60_000;
const base = Date.UTC(2026, 9, 1);
const instant = (milliseconds: number) =>
  new Date(base + milliseconds).toISOString();
const privateEnvironment = jest.requireActual('node:process').env as Record<
  string,
  string | undefined
>;

async function fixture(density?: number) {
  const f = await sharedAncestryProfileFixture(1, false);
  const template = (await f.storage.read('turn-0'))!;
  const read = createLocalEvidenceData(f.database).readHealthContext!;
  const signal = new AbortController().signal;
  for (let d = 0; d < 21; d++) {
    const row = (name: string, concept: string, from: number, to = from) =>
      healthObservation(
        `${d}-${name}`,
        concept,
        instant(d * day + from * minute),
        'healthkit',
        'imported',
        instant(d * day + to * minute),
      );
    // Controlled variety, not a proxy for a person's records: overlapping workouts,
    // dense heart points, sleep intervals, a light step series.
    const samples =
      density ??
      Number(privateEnvironment.OROT_SYNTHETIC_HEALTH_DENSITY ?? '360');
    const rows = [
      row('workout-early', 'workout_duration', 522, 584),
      row('workout-nested', 'workout_duration', 541, 554),
      row('workout-later', 'workout_duration', 1034, 1075),
      row('sleep-core', 'HKCategoryTypeIdentifierSleepAnalysis', 14, 314),
      row('sleep-overlap', 'HKCategoryTypeIdentifierSleepAnalysis', 291, 388),
      row('steps', 'step_count', 600, 630),
      ...Array.from({ length: samples }, (_, i) =>
        row(`heart-${i}`, 'heart_rate', 20 + Math.floor((1300 * i) / samples)),
      ),
    ];
    await f.database.execute(
      `INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json)
       SELECT json_extract(value,'$.id'),json_extract(value,'$.effectiveAt'),
       json_extract(value,'$.recordedAt'),json_extract(value,'$.ingestedAt'),value FROM json_each(?)`,
      [JSON.stringify(rows)],
    );
  }
  const ranges = Array.from({ length: 18 }, (_, i) => ({
    id: `overlap-${i}`,
    topic: (['measurements', 'activity', 'sleep'] as const)[i % 3]!,
    window: {
      fromInclusive: instant((i % 6) * day),
      toExclusive: instant((i === 0 ? 3 : 12 + Math.floor(i / 3)) * day),
      timeZone: 'UTC',
      ...(i % 4 === 0 ? { dataAvailableThrough: instant(30 * day) } : {}),
    },
  }));
  for (const { id, topic, window } of ranges) {
    const item = registerHealthContextEvidence({
      read,
      registry: f.input.registry,
      report: await read(window, [topic]),
      scope: { kind: 'health_context_period', version: 1, topic, window },
    });
    const captured = await captureConversationSources(
      [item],
      f.input.registry,
      signal,
    );
    await f.storage.append({
      ...template,
      id,
      sources: [...captured.sources],
      citations: [captured.sources[0]!.reference],
    });
  }
  return { f, read, ranges, signal };
}

const families = {
  heart: 'workouts AS MATERIALIZED',
  sleep: 'WITH RECURSIVE calendar',
  quantity: 'observations AS MATERIALIZED',
  symptom: 'occurrences AS MATERIALIZED',
  generation: 'SELECT mutations, deletions FROM health_context_generation',
  marker: 'linked_ids(id) AS (',
} as const;
function family(sql: string) {
  if (
    /^(?:CREATE TEMP TABLE|INSERT INTO|DROP TABLE IF EXISTS) temp\.orot_heart_workout_prefix/.test(
      sql,
    )
  )
    return 'heartPrefixSetupCleanup';
  return (
    Object.entries(families).find(([, needle]) => sql.includes(needle))?.[0] ??
    'other'
  );
}

test.each([
  'dense',
  'sparse',
  'restored-old-engine',
  'restored-no-cover',
] as const)(
  'pairs published and candidate on cold owned report windows: %s',
  async dataset => {
    const { f, ranges, signal } = await fixture(
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
          const k = family(sql);
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
    for (const candidate of [false, true]) {
      const { f } = await fixture(2);
      const signal = new AbortController().signal;
      const scope = f.storage.beginReadOperation(signal)!;
      const realRead = reader.readHealthContextReport;
      const txOriginal = f.database.transaction.bind(f.database);
      const entered = gate();
      const resume = gate();
      let held = false;
      let usedIndexed = false;
      const work = jest
        .spyOn(reader, 'readHealthContextReport')
        .mockImplementation((...args) => {
          if (!candidate) args[7] = undefined;
          return realRead(...args);
        });
      f.database.transaction = fn =>
        txOriginal(async tx => {
          const execute = tx.execute.bind(tx);
          tx.execute = async (sql, args) => {
            const result = await execute(sql, args);
            if (sql.includes('sum(amount ORDER BY')) usedIndexed = true;
            if (!held && family(sql) === 'heart') {
              held = true;
              entered.release();
              await resume.wait;
            }
            return result;
          };
          await fn(tx);
        });
      const reading = readOwnedBoundParentRows(scope, f.storage, signal, [
        'overlap-3',
      ])!;
      const result = reading.then(
        value => ({ value }),
        error => ({ error }),
      );
      try {
        await Promise.race([entered.wait, result]);
        expect(held).toBe(true);
        expect(usedIndexed).toBe(candidate);
        const id = '4-heart-0';
        if (effect === 'replace')
          await f.database.execute(
            "UPDATE health_observations SET payload_json=json_set(payload_json,'$.value.amount',321) WHERE id=?",
            [id],
          );
        else if (effect === 'delete')
          await f.database.execute(
            'DELETE FROM health_observations WHERE id=?',
            [id],
          );
        else
          await f.database.execute(
            'INSERT INTO agent_memory_removed_sources VALUES (?)',
            [id],
          );
        resume.release();
        const settled = await result;
        if ('value' in settled) expect(settled.value?.rows).toEqual([null]);
        else expect(settled.error).toBeInstanceOf(Error);
        const after = await readOwnedBoundParentRows(scope, f.storage, signal, [
          'overlap-3',
        ]);
        expect(after?.rows).toEqual([null]);
        const records = (
          await f.database.execute(
            "SELECT json_extract(payload_json,'$.value.amount') AS amount FROM health_observations WHERE id=?",
            [id],
          )
        ).rows;
        expect(records).toEqual(
          effect === 'delete'
            ? []
            : [{ amount: effect === 'replace' ? 321 : 72 }],
        );
        expect(
          (
            await f.database.execute(
              "SELECT name FROM sqlite_temp_schema WHERE name='orot_heart_workout_prefix'",
            )
          ).rows,
        ).toEqual([]);
      } finally {
        resume.release();
        await result;
        scope.dispose();
        work.mockRestore();
        f.close();
      }
    }
  },
  30_000,
);

test('revoked canonical reader cannot select indexed quantities after capability await', async () => {
  const { f, signal } = await fixture(2);
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
