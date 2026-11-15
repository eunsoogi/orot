import { HealthObservationSchema } from '@orot/domain';
import type { DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceQueries';
import { dailyReportGuidance } from '../dailyReportGuidance';
import { dailyReportFacts } from '../dailyReportFacts';

const sample = (
  concept: string,
  amount: number,
  unit = 'mmHg',
  id = 'synthetic',
): LocalHealthEvidenceRecord => ({
  kind: 'health_observation',
  record: HealthObservationSchema.parse({
    id,
    concept,
    observationKind: 'measurement',
    value: { kind: 'quantity', amount, unit },
    effectiveAt: '2035-01-01T01:00:00Z',
    recordedAt: '2035-01-01T01:00:00Z',
    ingestedAt: '2035-01-01T01:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  }),
});
const sources = (
  values: LocalHealthEvidenceRecord[],
): DailyReportSourceRecord[] =>
  values.map(v => ({
    source: v.kind,
    recordId: v.record.id,
    revision: '1',
    occurrence: { startInclusive: v.record.effectiveAt! },
    ingestedAt: v.record.ingestedAt,
  }));
const guidance = (...values: LocalHealthEvidenceRecord[]) =>
  dailyReportGuidance(values, sources(values));

test.each([
  ['blood_pressure_systolic', 180],
  ['blood_pressure_diastolic', 120],
])(
  'severe boundary prioritizes conditional emergency guidance for %s',
  (concept, amount) => {
    const result = guidance(
      sample(concept, amount),
      sample('step_count', 8, 'count', 'steps'),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toContain('재측정을 기다리지 말고 119');
    expect(result[0]?.text).toContain('과거 기록만으로 현재 응급상태');
    expect(result[0]?.sourceReferences).toEqual([
      { source: 'health_observation', recordId: 'synthetic' },
    ]);
  },
);
test.each([
  ['blood_pressure_systolic', 135],
  ['blood_pressure_diastolic', 85],
])('adult reference boundary does not diagnose %s', (concept, amount) => {
  const text = guidance(sample(concept, amount))[0]!.text;
  expect(text).toContain('한 번의 수치로 고혈압을 진단하는 기준이 아니');
  expect(text).toContain('반복해서 높으면 의사와 상담');
  expect(text).toContain('약은 임의로 변경하지');
});
test('low, unsupported units and conflicting nonsevere readings never become reassurance or category', () => {
  expect(guidance(sample('blood_pressure_systolic', 134))).toEqual([]);
  expect(guidance(sample('blood_pressure_systolic', 190, 'kPa'))).toEqual([]);
  expect(
    guidance(
      sample('blood_pressure_systolic', 145),
      sample('blood_pressure_systolic', 110, 'mmHg', 'other'),
    ),
  ).toEqual([]);
});
test('a conflicting severe reading is not silently ignored', () => {
  expect(
    guidance(
      sample('blood_pressure_systolic', 180),
      sample('blood_pressure_systolic', 110, 'mmHg', 'other'),
    )[0]?.text,
  ).toContain('우선 확인');
});
test('missing workout is not inactivity; partial step sample is never a daily total', () => {
  const text = guidance(sample('step_count', 8, 'count'))[0]!.text;
  expect(text).toContain('실제로 운동을 하지 않았다는 뜻은 아니');
  expect(text).toContain('불편한 증상이나 운동 제한이 없다면');
  expect(text).not.toContain('운동 부족');
});
test('display names and units are localized while model facts preserve exact stored fields', () => {
  const values = [sample('step_count', 8, 'count')];
  const facts = dailyReportFacts(values, sources(values));
  expect(facts[0]?.text).toContain('걸음 수: 8 걸음');
  expect(facts[0]?.text).not.toContain('step_count');
  expect(facts[0]?.text).not.toContain('2035-01-01T');
  expect(facts[0]?.modelText).toContain('step_count: 8 count');
  expect(values[0]?.record).toHaveProperty('value.unit', 'count');
});
test('source identity mismatch fails closed', () => {
  const values = [sample('step_count', 8, 'count')];
  expect(() => dailyReportGuidance(values, [])).toThrow(
    'Snapshot source mismatch',
  );
});
