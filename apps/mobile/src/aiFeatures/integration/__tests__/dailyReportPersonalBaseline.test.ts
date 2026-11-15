import {
  calendarTestObservation,
  calendarFixture,
  calendarReportService,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';
import { dailyReportCoverageCounts } from '../dailyReportCoverageCounts';
import { dailyReportPersonalBaseline } from '../dailyReportPersonalBaseline';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { readDailyReportSnapshot } from '../../../healthEvidence/healthContext/dailyReportSnapshot';

const observation = (
  id: string,
  at: string,
  amount: number,
  unit = 'count/min',
) => ({
  ...calendarTestObservation,
  id,
  effectiveAt: at,
  recordedAt: at,
  ingestedAt: at,
  concept: 'resting_heart_rate',
  value: { kind: 'quantity' as const, amount, unit },
});
const point = (id: string, at: string, amount: number, unit?: string) => ({
  kind: 'health_observation' as const,
  record: observation(id, at, amount, unit),
});
const today = [point('today', '2035-01-01T01:00:00Z', 80)];
const history = [
  point('old-a', '2034-12-29T01:00:00Z', 60),
  point('old-b', '2034-12-30T01:00:00Z', 65),
  point('old-c', '2034-12-31T01:00:00Z', 70),
];
const references = [...today, ...history].map(item => ({
  source: item.kind,
  recordId: item.record.id,
  revision: 'fixture',
  occurrence: { startInclusive: item.record.effectiveAt },
  ingestedAt: item.record.ingestedAt,
}));

test('compares daily medians without diagnosing or overweighting frequently measured days', () => {
  const extra = Array.from({ length: 10 }, (_, i) =>
    point(`extra-${i}`, `2034-12-29T02:${String(i).padStart(2, '0')}:00Z`, 61),
  );
  const extraRefs = extra.map(item => ({
    source: item.kind,
    recordId: item.record.id,
    revision: 'fixture',
    occurrence: { startInclusive: item.record.effectiveAt },
    ingestedAt: item.record.ingestedAt,
  }));
  const facts = dailyReportPersonalBaseline(
    today,
    [...history, ...extra],
    [...references, ...extraRefs],
    'UTC',
  );
  expect(facts[0]?.text).toContain('80 회/분');
  expect(facts[0]?.text).toContain('65 회/분');
  expect(facts[0]?.text).toContain('관측된 3일');
  expect(facts[0]?.text).toContain('질병 진단 기준은 아니');
});

test('does not compare sparse, conflicting, incompatible-unit or unknown imported sources', () => {
  expect(
    dailyReportPersonalBaseline(today, history.slice(0, 2), references, 'UTC'),
  ).toEqual([]);
  expect(
    dailyReportPersonalBaseline(
      today,
      history.map(item =>
        point(item.record.id, item.record.effectiveAt, 1, 'other'),
      ),
      references,
      'UTC',
    ),
  ).toEqual([]);
  expect(
    dailyReportPersonalBaseline(
      today,
      [...history, point('conflict', history[0]!.record.effectiveAt, 100)],
      references,
      'UTC',
    ),
  ).toEqual([]);
  const imported = [...today, ...history].map(item => ({
    ...item,
    record: {
      ...item.record,
      provenance: { origin: 'imported' as const, sourceRecordIds: [] },
    },
  }));
  expect(
    dailyReportPersonalBaseline(
      imported.slice(0, 1),
      imported.slice(1),
      references,
      'UTC',
    ),
  ).toEqual([]);
});

test('real SQLite history stays historical, consent-bound and invalidates retained prose when deleted', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  native.revoke();
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    for (const item of [...today, ...history])
      await repository.put('health_observation', item.record);
    await repository.put(
      'health_observation',
      observation('too-old', '2034-12-01T00:00:00Z', 1),
    );
    const day = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (day.status !== 'ready') throw new Error('fixture');
    const snapshot = await readDailyReportSnapshot(
      connection.database,
      day.context,
      {},
    );
    expect(snapshot.values).toHaveLength(1);
    expect(snapshot.baselineValues).toHaveLength(3);
    expect(
      dailyReportCoverageCounts(snapshot.sourceSnapshot.records).get(
        'health_observation',
      ),
    ).toBe(1);
    expect(
      dailyReportCoverageCounts(snapshot.sourceSnapshot.records).get(
        'personal_baseline',
      ),
    ).toBe(3);
    const scoped = await readDailyReportSnapshot(
      connection.database,
      day.context,
      { sourceIds: ['today'] },
    );
    expect(scoped.baselineValues).toHaveLength(0);
    expect(
      snapshot.sourceSnapshot.records.filter(
        record => record.contextRole === 'personal_baseline',
      ),
    ).toHaveLength(3);
    const { run, consent } = calendarReportService(connection.database, native);
    const result = await run(calendarTestRequest());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(
      result.report.supportedContext.some(claim =>
        claim.text.includes('관측된 3일'),
      ),
    ).toBe(true);
    expect(JSON.stringify(consent.mock.calls)).toContain('관측된 3일');
    const store = createDailyReportStorage(connection.database, native.read);
    expect((await store.lookup(result.context.identity)).status).toBe('saved');
    await connection.database.execute(
      'DELETE FROM health_observations WHERE id = ?',
      ['old-a'],
    );
    expect((await store.lookup(result.context.identity)).status).toBe(
      'deleted',
    );
  } finally {
    connection.close();
  }
});
