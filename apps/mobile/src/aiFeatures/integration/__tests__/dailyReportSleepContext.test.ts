import {
  calendarFixture,
  calendarReportService,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';
import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { dailyReportSleepContext } from '../dailyReportSleepContext';

function window(
  date = '2035-01-01',
  zone = 'UTC',
  at = '2035-01-01T12:00:00Z',
) {
  const result = createDailyReportCalendarWindow({
    localDate: date,
    timeZone: zone,
    requestedAt: at,
  });
  if (result.status !== 'ready') throw new Error('fixture');
  return result.context;
}
function sample(
  id: string,
  stage: string,
  start: string,
  end: string,
  source = 'watch',
) {
  return {
    kind: 'health_observation' as const,
    record: HealthObservationSchema.parse({
      id,
      effectiveAt: start,
      endedAt: end,
      recordedAt: end,
      ingestedAt: end,
      provenance: {
        origin: 'imported',
        sourceRecordIds: [],
        source: { system: 'healthkit', sourceIdentifier: source },
      },
      reviewState: { status: 'unreviewed' },
      observationKind: 'other',
      concept: 'sleep',
      value: { kind: 'text', text: stage },
    }),
  };
}
const sources = (values: ReturnType<typeof sample>[]) =>
  values.map(item => ({
    source: item.kind,
    recordId: item.record.id,
    revision: 'synthetic',
    occurrence: {
      startInclusive: item.record.effectiveAt,
      endExclusive: item.record.endedAt,
    },
    ingestedAt: item.record.ingestedAt,
  }));

test('overlapping stages merge within a source, never count in-bed time or sum devices', () => {
  const values = [
    sample('in-bed', 'inBed', '2034-12-31T22:00:00Z', '2035-01-01T08:00:00Z'),
    sample('core', '3', '2034-12-31T23:00:00Z', '2035-01-01T02:00:00Z'),
    sample(
      'deep',
      'asleepDeep',
      '2035-01-01T01:00:00Z',
      '2035-01-01T03:00:00Z',
    ),
    sample(
      'other',
      'asleepREM',
      '2035-01-01T00:00:00Z',
      '2035-01-01T03:00:00Z',
      'ring',
    ),
  ];
  const facts = dailyReportSleepContext(values, sources(values), window());
  expect(facts).toHaveLength(2);
  expect(facts.every(f => f.text.includes('약 3시간 0분'))).toBe(true);
  expect(facts[0]!.sourceReferences).toHaveLength(3);
  expect(facts[0]!.text).toContain('밤 전체가 아닐 수');
  expect(facts[0]!.text).toContain('다른 출처와 합산하지');
});

test('DST elapsed intervals are clipped by civil-day bounds and conflicting or unknown stages do not become zero sleep', () => {
  const values = [
    sample(
      'dst',
      'asleepCore',
      '2026-11-01T01:00:00-04:00',
      '2026-11-01T02:00:00-05:00',
    ),
  ];
  const calendar = window(
    '2026-11-01',
    'America/New_York',
    '2026-11-01T12:00:00-05:00',
  );
  expect(
    dailyReportSleepContext(values, sources(values), calendar)[0]!.text,
  ).toContain('약 2시간 0분');
  values.push(
    sample(
      'awake',
      'awake',
      '2026-11-01T01:30:00-04:00',
      '2026-11-01T01:45:00-04:00',
    ),
  );
  expect(
    dailyReportSleepContext(values, sources(values), calendar)[0]!.text,
  ).toContain('확정하지 않았어요');
  const unknown = [
    sample('unknown', '8', '2035-01-01T00:00:00Z', '2035-01-01T01:00:00Z'),
  ];
  const text = dailyReportSleepContext(unknown, sources(unknown), window())[0]!
    .text;
  expect(text).toContain('잠을 자지 않았다는 뜻은 아니');
  expect(text).toContain('알 수 없는 단계');
  expect(text).not.toContain('0시간');
  expect(dailyReportSleepContext([], [], window())).toEqual([]);
});

test('sleep interpretation enters exact consent, remains cited after save, and is hidden after source deletion', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  native.revoke();
  try {
    await runMigrations(connection.database);
    const repo = createRecordRepository(connection.database);
    const value = sample(
      'sleep',
      'asleepCore',
      '2034-12-31T23:00:00Z',
      '2035-01-01T03:00:00Z',
    );
    await repo.put('health_observation', value.record);
    const { run, generate, consent } = calendarReportService(
      connection.database,
      native,
    );
    const result = await run(calendarTestRequest());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    const fact = result.report.supportedContext.find(c =>
      c.text.includes('약 3시간 0분'),
    );
    expect(fact?.section).toBe('patterns');
    expect(fact?.sourceReferences).toEqual([
      { source: 'health_observation', recordId: 'sleep' },
    ]);
    expect(generate.mock.calls[0]![0]).toEqual(
      consent.mock.calls[0]![0].payload,
    );
    expect(JSON.stringify(generate.mock.calls[0]![0])).toContain(
      '약 3시간 0분',
    );
    const storage = createDailyReportStorage(connection.database, native.read);
    expect((await storage.lookup(result.context.identity)).status).toBe(
      'saved',
    );
    await repo.delete('health_observation', 'sleep');
    expect((await storage.lookup(result.context.identity)).status).toBe(
      'deleted',
    );
  } finally {
    connection.close();
  }
});

test('sub-minute and future intervals remain truthful and source summaries are explicitly bounded', () => {
  const short = [
    sample(
      'short',
      'asleepCore',
      '2035-01-01T01:00:00Z',
      '2035-01-01T01:00:30Z',
    ),
  ];
  expect(
    dailyReportSleepContext(short, sources(short), window())[0]!.text,
  ).toContain('1분 미만');
  const future = [
    sample(
      'future',
      'asleepCore',
      '2035-01-01T11:00:00Z',
      '2035-01-01T13:00:00Z',
    ),
  ];
  expect(
    dailyReportSleepContext(future, sources(future), window())[0]!.text,
  ).toContain('유효하지 않은 구간');
  const many = ['a', 'b', 'c', 'd'].map(id =>
    sample(
      id,
      'asleepCore',
      '2035-01-01T01:00:00Z',
      '2035-01-01T02:00:00Z',
      id,
    ),
  );
  const facts = dailyReportSleepContext(many, sources(many), window());
  expect(facts).toHaveLength(4);
  expect(facts[3]!.text).toContain('최대 세 그룹');
  expect(facts[3]!.sourceReferences).toHaveLength(4);
});
