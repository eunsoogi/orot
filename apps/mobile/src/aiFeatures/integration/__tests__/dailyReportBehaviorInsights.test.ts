import {
  calendarTestObservation,
  calendarFixture,
  calendarReportService,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';
import { DoseEventSchema, HealthObservationSchema } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceQueries';
import { dailyReportBehaviorInsights } from '../dailyReportBehaviorInsights';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';

const dose = (
  id: string,
  date: string,
  status: 'taken' | 'skipped' | 'unknown',
): LocalHealthEvidenceRecord => ({
  kind: 'dose_event',
  record: DoseEventSchema.parse({
    id,
    eventKind: 'observed',
    medicationDefinitionId: 'synthetic-med',
    observationStatus: status,
    effectiveAt: `${date}T01:00:00Z`,
    ingestedAt: `${date}T02:00:00Z`,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  }),
});
const workout = (id: string, date: string): LocalHealthEvidenceRecord => ({
  kind: 'health_observation',
  record: HealthObservationSchema.parse({
    ...calendarTestObservation,
    id,
    effectiveAt: `${date}T01:00:00Z`,
    endedAt: `${date}T02:00:00Z`,
    recordedAt: `${date}T02:00:00Z`,
    ingestedAt: `${date}T03:00:00Z`,
    concept: 'workout_duration',
    value: { kind: 'quantity', amount: 30, unit: 'min' },
    workout: { activityType: 37, activityName: 'running' },
  }),
});
const source = (item: LocalHealthEvidenceRecord) => ({
  source: item.kind,
  recordId: item.record.id,
  revision: 'synthetic',
  occurrence: { startInclusive: item.record.effectiveAt! },
  ingestedAt: item.record.ingestedAt,
});
const summarize = (
  today: LocalHealthEvidenceRecord[],
  history: LocalHealthEvidenceRecord[],
) =>
  dailyReportBehaviorInsights(
    today,
    history,
    [...today, ...history].map(source),
    'UTC',
  );

test('completed, skipped and unknown historical days remain explicit and are not adherence percentages', () => {
  const today = [dose('today', '2035-01-01', 'taken')];
  const history = [
    dose('taken', '2034-12-30', 'taken'),
    dose('missed', '2034-12-31', 'skipped'),
    dose('unknown', '2034-12-29', 'unknown'),
  ];
  const text = summarize(today, history)[0]!.text;
  expect(text).toContain('실제 복용·투여를 완료');
  expect(text).toContain('1일에는 누락·건너뜀');
  expect(text).toContain('미기록·상태 불명');
  expect(text).toContain('과거 누락분을 지금 보충');
  expect(text).toContain('복약 이행률은 계산하지');
  expect(text).not.toContain('오늘 누락');
});

test('workout days do not imply intensity or inactivity, and urgent readings suppress encouragement', () => {
  const history = [workout('w1', '2034-12-30'), workout('w2', '2034-12-30')];
  expect(summarize([], history)[0]?.text).toContain('중 1일');
  expect(summarize([], history)[0]?.text).toContain(
    '실제로 운동하지 않았다는 뜻은 아니',
  );
  const severe: LocalHealthEvidenceRecord = {
    kind: 'health_observation',
    record: HealthObservationSchema.parse({
      ...calendarTestObservation,
      concept: 'blood_pressure_systolic',
      value: { kind: 'quantity', amount: 190, unit: 'mmHg' },
    }),
  };
  const result = summarize([severe], history)[0]!;
  expect(result.text).toContain('응급·재확인 안내를 먼저');
  expect(result.text).not.toContain('가벼운 움직임부터');
  expect(result.sourceReferences).toContainEqual({
    source: 'health_observation',
    recordId: severe.record.id,
  });
});

test('real SQLite history enters exact consent and is hidden on source deletion', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  native.revoke();
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    for (const item of [
      dose('today', '2035-01-01', 'taken'),
      dose('old-missed', '2034-12-30', 'skipped'),
      workout('old-workout', '2034-12-31'),
    ])
      await repository.put(item.kind, item.record);
    const { run, consent } = calendarReportService(connection.database, native);
    const result = await run(calendarTestRequest());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(
      result.context.sourceSnapshot.records.filter(row => row.contextRole),
    ).toHaveLength(2);
    expect(
      result.report.supportedContext.map(item => item.text).join(' '),
    ).toContain('과거 누락분을 지금 보충');
    expect(JSON.stringify(consent.mock.calls)).toContain('완료된 운동 구간');
    const store = createDailyReportStorage(connection.database, native.read);
    expect((await store.lookup(result.context.identity)).status).toBe('saved');
    await repository.delete('dose_event', 'old-missed');
    expect((await store.lookup(result.context.identity)).status).toBe(
      'deleted',
    );
  } finally {
    connection.close();
  }
});
