import { sleepIntervalCalendarSql } from '../sleepIntervalCalendarSql';
import {
  createRecordRepository,
  runMigrations,
  localQueryTimestampKeyExpression,
} from '@orot/storage';
import type { SqlExecutor, SqlValue } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { currentEvidenceCondition } from '../../evidenceCandidateScope';
import { healthContextCalendarSql } from '../calendarSql';
import { readHealthSleepContext } from '../sleepQuery';
import { readHealthSymptomContext } from '../symptomQuery';
import { healthContextDays } from '../window';

/** Retain the pre-optimization day joins as an exact-result oracle, not as the production execution plan. */
function legacy(executor: SqlExecutor): SqlExecutor {
  return {
    execute: async (sql: string, parameters: SqlValue[] = []) => {
      // Normalize only the new interval calendar connector before applying the frozen legacy oracle.
      sql = sql.replace(
        sleepIntervalCalendarSql,
        `samples AS MATERIALIZED (
      SELECT d.date, max(o.start, d.from_at) * 86400 AS start,
        min(o.finish, d.to_at) * 86400 AS finish, o.stage
      FROM observations o JOIN days d ON o.start < d.to_at AND o.finish > d.from_at
    )`,
      );
      if (sql.includes('calendar_sweep')) {
        const at = localQueryTimestampKeyExpression(
          "coalesce(json_extract(r.payload_json, '$.startedAt'), r.effective_at)",
        );
        const ingestion = localQueryTimestampKeyExpression('r.ingested_at');
        return executor.execute(
          `SELECT * FROM (WITH days(date,from_key,to_key) AS (${healthContextCalendarSql})
        SELECT count(*) AS entries,count(DISTINCT days.date) AS recorded_days
        FROM symptom_entries r JOIN days ON ${at} >= days.from_key AND ${at} < days.to_key
        WHERE ${currentEvidenceCondition('symptom_entry')} ${parameters.length === 4 ? `AND ${ingestion} <= ?` : ''})`,
          parameters.length === 4
            ? [parameters[0]!, parameters[3]!]
            : [parameters[0]!],
        );
      }
      if (sql.includes('samples AS MATERIALIZED')) {
        const stage = sql.slice(
          sql.indexOf('CASE json_extract'),
          sql.indexOf('END AS stage') + 'END AS stage'.length,
        );
        const where = sql.slice(
          sql.indexOf('WHERE json_extract'),
          sql.indexOf('    ), samples AS MATERIALIZED'),
        );
        sql = `SELECT * FROM (WITH days(date,from_at,to_at) AS (${healthContextCalendarSql}), samples AS (
        SELECT d.date,max(julianday(r.effective_at),julianday(d.from_at))*86400 AS start,
        min(julianday(json_extract(r.payload_json,'$.endedAt')),julianday(d.to_at))*86400 AS finish, ${stage}
        FROM health_observations r JOIN days d ON julianday(r.effective_at)<julianday(d.to_at)
        AND julianday(json_extract(r.payload_json,'$.endedAt'))>julianday(d.from_at) ${where}
        ${sql.slice(sql.indexOf('    ), intervals AS ('))}`;
      }
      return executor.execute(sql, parameters);
    },
  };
}
const symptom = (
  id: string,
  startedAt: string,
  ingestedAt = '2026-11-03T00:00:00Z',
) => ({
  id,
  status: 'active' as const,
  effectiveAt: startedAt,
  recordedAt: startedAt,
  ingestedAt,
  description: 'Synthetic complete description ' + id,
  severity: 3,
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
});

test('preserves exact old sleep and symptom results across DST, submillisecond edges and source lifecycle filters', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const days = healthContextDays({
      fromInclusive: '2026-11-01T04:00:00.0004Z',
      toExclusive: '2026-11-03T05:00:00.0004Z',
      timeZone: 'America/New_York',
    });
    const cutoff = '2026-11-04T00:00:00.0004Z';
    for (const [id, start, ingest] of [
      ['before', '2026-11-01T04:00:00.0003Z', cutoff],
      ['first', '2026-11-01T04:00:00.0004Z', cutoff],
      ['second', '2026-11-02T05:00:00Z', cutoff],
      ['last', '2026-11-03T05:00:00.0003Z', cutoff],
      ['outside', '2026-11-03T05:00:00.0004Z', cutoff],
      ['late', '2026-11-02T06:00:00Z', '2026-11-04T00:00:00.0005Z'],
      ['deleted', '2026-11-02T06:00:00Z', cutoff],
      ['stale', '2026-11-02T06:00:00Z', cutoff],
    ])
      await records.put('symptom_entry', symptom(id!, start!, ingest!));
    // Legacy imported payloads can contain startedAt even though current writes use effectiveAt.
    await database.execute(
      "UPDATE symptom_entries SET payload_json=json_set(payload_json,'$.startedAt',effective_at),effective_at='2020-01-01T00:00:00Z'",
    );
    await database.execute(
      'INSERT INTO legacy_symptom_deleted(id) VALUES (?)',
      ['deleted'],
    );
    await database.execute(
      'INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES (?,?,?,?,?,?)',
      ['t', 'symptom_entry', 'stale', 'old', 'new', cutoff],
    );
    for (const [id, code, ingest] of [
      ['core', '3', cutoff],
      ['duplicate', '3', cutoff],
      ['deep', '4', cutoff],
      ['unknown', '99', cutoff],
      ['stale', '3', cutoff],
      ['late', '3', '2026-11-04T00:00:00.0005Z'],
    ])
      await records.put('health_observation', {
        ...healthObservation(
          'sleep-' + id,
          'HKCategoryTypeIdentifierSleepAnalysis',
          '2026-11-01T23:30:00.0004Z',
          'healthkit',
          'imported',
          '2026-11-02T05:30:00.0003Z',
        ),
        value: { kind: 'text', text: code! },
        ingestedAt: ingest!,
      });
    await database.execute(
      'INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES (?,?,?,?,?,?)',
      ['t', 'health_observation', 'sleep-stale', 'old', 'new', cutoff],
    );
    const actual = await readHealthSymptomContext(database, days, cutoff);
    expect(actual).toEqual(
      await readHealthSymptomContext(legacy(database), days, cutoff),
    );
    expect(actual.entryCount).toBe(3);
    expect(actual.recordedDays).toBe(3);
    expect(actual.latest.map(row => row.description)).toEqual(
      ['last', 'second', 'first'].map(
        id => 'Synthetic complete description ' + id,
      ),
    );
    const sleep = await readHealthSleepContext(
      database,
      days,
      undefined,
      cutoff,
    );
    expect(sleep).toEqual(
      await readHealthSleepContext(legacy(database), days, undefined, cutoff),
    );
    expect(sleep.unsupportedCategories).toBe(true);
    expect(sleep.days.map(day => day.sampleCount)).toEqual([4, 4]);
  } finally {
    close();
  }
});

test('retains all multi-year rows with one calendar scan and no per-day symptom join', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const start = Date.parse('2020-01-01T00:00:00Z');
    const at = (day: number) => new Date(start + day * 86400000).toISOString();
    const count = 1460;
    for (let i = 0; i < count; i++) {
      await records.put('symptom_entry', symptom('row-' + i, at(i + 0.5)));
      await records.put(
        'health_observation',
        healthObservation(
          'sleep-' + i,
          'HKCategoryTypeIdentifierSleepAnalysis',
          at(i + 0.8),
          'healthkit',
          'imported',
          at(i + 1.1),
        ),
      );
    }
    const days = healthContextDays({
      fromInclusive: at(0),
      toExclusive: at(count),
      timeZone: 'UTC',
    });
    const plans: string[] = [];
    const observed: SqlExecutor = {
      execute: async (sql, params) => {
        plans.push(
          ...(
            await database.execute('EXPLAIN QUERY PLAN ' + sql, params)
          ).rows.map(row => String(row.detail)),
        );
        return database.execute(sql, params);
      },
    };
    const startTime = Date.now();
    const actual = await readHealthSymptomContext(observed, days);
    const symptomMs = Date.now() - startTime;
    const sleepTime = Date.now();
    const sleep = await readHealthSleepContext(observed, days);
    const sleepMs = Date.now() - sleepTime;
    expect(actual).toEqual(
      await readHealthSymptomContext(legacy(database), days),
    );
    expect(sleep).toEqual(await readHealthSleepContext(legacy(database), days));
    expect(actual.entryCount).toBe(count);
    expect(actual.recordedDays).toBe(count);
    expect(actual.latest).toHaveLength(count);
    expect(sleep.days).toHaveLength(count);
    expect(plans.filter(row => row.includes('SCAN json_each'))).toHaveLength(2);
    expect(plans.some(row => row.includes('MATERIALIZE samples'))).toBe(true);
    console.info(
      JSON.stringify({
        syntheticRows: count,
        calendarDays: days.length,
        symptomMs,
        sleepMs,
      }),
    );
  } finally {
    close();
  }
}, 60000);
