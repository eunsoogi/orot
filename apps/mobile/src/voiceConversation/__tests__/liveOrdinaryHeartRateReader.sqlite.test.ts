import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  createHealthContextReader,
  readHealthContextReport,
} from '../../healthEvidence/healthContext/reader';
import { projectHealthContext } from '../../healthEvidence/healthContext/projection';
import { recentHealthContextWindow } from '../../healthEvidence/healthContext/window';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { liveHeartRateAggregate } from '../liveHeartRateAggregate';
import { createLiveOrdinaryHeartRateReader } from '../liveOrdinaryHeartRateReader';
import { stageLiveResponsesResult } from '../stageLiveResponsesResult';

const at = '2026-10-03T03:00:00.000Z';
const timeZone = 'Asia/Seoul';
const times = [
  '2026-10-01T13:00:00Z',
  '2026-10-01T14:00:00Z',
  '2026-10-01T16:00:00Z',
  '2026-10-02T16:00:00Z',
];
function rate(index: number, amount: number, effectiveAt = times[index]!) {
  return {
    ...healthObservation('heart-' + index, 'heart_rate', effectiveAt),
    ingestedAt: effectiveAt,
    value: { kind: 'quantity' as const, amount, unit: 'count/min' },
  };
}
async function fixture(prepared = true) {
  const raw = openSqliteTestDatabase(':memory:');
  const statements: string[] = [];
  const returnedConcepts: unknown[] = [];
  const execute =
    (target: Pick<SqlTransaction, 'execute'>): SqlTransaction['execute'] =>
    async (sql, params) => {
      statements.push(sql);
      const result = await target.execute(sql, params);
      if (sql.includes('sensor_counts AS'))
        returnedConcepts.push(...result.rows.map(row => row.concept));
      return result;
    };
  const adapter: SqlDatabase = {
    ...raw.database,
    execute: execute(raw.database),
    transaction: operation =>
      raw.database.transaction(tx =>
        operation({
          execute: execute(tx),
          commit: () => tx.commit(),
          rollback: () => tx.rollback(),
        }),
      ),
  };
  const db = guardedNativeDatabase(adapter);
  await runMigrations(db);
  if (prepared)
    await createHealthContextReader(db)(
      recentHealthContextWindow(3, at, timeZone),
      ['measurements'],
    );
  const records = createRecordRepository(db);
  const signal = new AbortController();
  let sameDatabase = true;
  let owns = true;
  const protection = jest.fn<Promise<boolean | null>, []>(async () => true);
  const read = createLiveOrdinaryHeartRateReader({
    database: db,
    ownsDatabase: candidate => candidate === db && sameDatabase,
    confirmProtection: protection,
  });
  return {
    db,
    records,
    statements,
    returnedConcepts,
    read,
    close: raw.close,
    protection,
    signal,
    input: {
      days: 3,
      at,
      timeZone,
      signal: signal.signal,
      current: () => owns,
    },
    retireOwner: () => {
      owns = false;
    },
    replaceDb: () => {
      sameDatabase = false;
    },
    resetReadTrace() {
      returnedConcepts.length = 0;
      statements.length = 0;
    },
    async seed() {
      for (const [idx, amount] of [60, 120, 30, 60].entries())
        await records.put('health_observation', rate(idx, amount));
      await records.put('health_observation', rate(4, 999, at));
      for (const concept of [
        'blood_glucose',
        'body_mass',
        'resting_heart_rate',
        'step_count',
      ])
        await records.put(
          'health_observation',
          healthObservation('unrelated-' + concept, concept, times[0]!),
        );
    },
  };
}
test('same canonical local days and daily-mean arithmetic but SQL groups only ordinary heart rate', async () => {
  const f = await fixture();
  try {
    await f.seed();
    const baseline = await readHealthContextReport(
      f.db,
      recentHealthContextWindow(3, at, timeZone),
      ['measurements'],
    );
    const old = liveHeartRateAggregate(
      'health_context: ' +
        JSON.stringify({
          topic: 'measurements',
          ...projectHealthContext(baseline, 'summary'),
        }),
      3,
    );
    f.resetReadTrace();
    const exact = await f.read(f.input);
    expect(JSON.parse(exact!.output)).toEqual(old);
    expect(JSON.parse(exact!.output)).toEqual({
      topic: 'measurements',
      metric: 'heart_rate',
      unit: 'count/min',
      days: 3,
      sampleCount: 4,
      meanOfRecordedDailyMeans: 60,
    });
    expect(await exact!.reprove()).toBe(true);
    expect(f.returnedConcepts).toEqual(Array(6).fill('heart_rate'));
    expect(f.statements.every(sql => /^SELECT\b/.test(sql.trim()))).toBe(true);
    for (const statement of f.statements.filter(sql =>
      sql.includes('sensor_counts AS'),
    ))
      expect(statement).toMatch(
        /AND lower\(json_extract\(r\.payload_json, '\$\.concept'\)\) = 'heart_rate'/,
      );
    exact!.proof.dispose();
  } finally {
    f.close();
  }
});
test.each([
  'fewer days',
  'another sensor',
  'deny protection',
  'foreign database',
  'denied operation',
  'unprepared',
  'native lock after SQL',
] as const)(
  '%s cannot mint an aggregate or access unapproved rows',
  async mode => {
    const f = await fixture(mode !== 'unprepared');
    try {
      await f.seed();
      if (mode === 'fewer days')
        await f.records.delete('health_observation', 'heart-3');
      if (mode === 'another sensor') {
        const other = rate(5, 72, times[3]!);
        await f.records.put('health_observation', {
          ...other,
          provenance: {
            ...other.provenance,
            source: {
              system: 'healthkit',
              sourceIdentifier: 'synthetic-other-sensor',
            },
          },
        });
      }
      if (mode === 'deny protection') f.protection.mockResolvedValueOnce(null);
      if (mode === 'foreign database') f.replaceDb();
      if (mode === 'denied operation') f.retireOwner();
      if (mode === 'native lock after SQL')
        f.protection.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      f.resetReadTrace();
      expect(await f.read(f.input)).toBeUndefined();
      if (
        ['deny protection', 'foreign database', 'denied operation'].includes(
          mode,
        )
      )
        expect(f.statements).toHaveLength(0);
      if (mode === 'unprepared') {
        expect(f.statements.every(sql => /^SELECT\b/.test(sql.trim()))).toBe(
          true,
        );
        expect(f.returnedConcepts).toEqual([]);
      }
    } finally {
      f.close();
    }
  },
);
test.each([
  'equal aggregate edit',
  'delete',
  'replaced owner',
  'abort',
] as const)(
  '%s prevents exact replay and causes zero synthetic handoff',
  async mode => {
    const f = await fixture();
    try {
      await f.seed();
      const exact = await f.read(f.input);
      if (mode === 'equal aggregate edit') {
        await f.records.put('health_observation', rate(0, 70));
        await f.records.put('health_observation', rate(1, 110));
        const fresh = await f.read(f.input);
        expect(fresh?.output).toBe(exact!.output);
        fresh?.proof.dispose();
      }
      if (mode === 'delete')
        await f.records.delete('health_observation', 'heart-3');
      if (mode === 'replaced owner') f.replaceDb();
      if (mode === 'abort') f.signal.abort();
      const deliver = jest.fn(async () => {});
      await stageLiveResponsesResult({
        id: 'synthetic-live-tool',
        output: exact!.output,
        signal: f.input.signal,
        proof: exact!.proof,
        current: f.input.current,
        reproveSource: exact!.reprove,
      }).admit(deliver);
      expect(deliver).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);
