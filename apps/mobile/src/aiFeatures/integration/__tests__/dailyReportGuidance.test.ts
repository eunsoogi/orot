import { HealthObservationSchema } from '@orot/domain';
import type { DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceQueries';
import { dailyReportGuidance } from '../dailyReportGuidance';
import {
  dailyReportFacts,
  conflictingDailyReportIndexes,
  incomparableDailyReportIndexes,
} from '../dailyReportFacts';

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
test('low and unsupported units never become reassurance or category', () => {
  expect(guidance(sample('blood_pressure_systolic', 134))).toEqual([]);
  expect(guidance(sample('blood_pressure_systolic', 190, 'kPa'))).toEqual([]);
});
test('a conflicting severe reading is not silently ignored', () => {
  const result = guidance(
    sample('blood_pressure_systolic', 180),
    sample('blood_pressure_systolic', 110, 'mmHg', 'other'),
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.text).toContain('우선 확인');
  expect(result[0]?.text).not.toContain('어느 기록이 정확한지');
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

test.each([
  ['blood_pressure_systolic', 145, 110],
  ['blood_pressure_diastolic', 90, 70],
  ['blood_pressure_systolic', 120, 110],
])(
  'conflicting %s readings retain uncertainty and both original sources',
  (concept, high, low) => {
    const values = [
      sample(concept, high),
      sample(concept, low, 'mmHg', 'other'),
    ];
    const original = JSON.stringify(values);
    const result = guidance(...values);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toContain('어느 기록이 정확한지 판단하지 않았어요');
    expect(result[0]?.text).toContain('혈압 재확인을 기다리지 말고 119');
    expect(result[0]?.text).toContain('1분 간격으로 두 번');
    expect(result[0]?.text).toContain('약은 임의로 변경하지');
    expect(result[0]?.sourceReferences).toEqual([
      { source: 'health_observation', recordId: 'synthetic' },
      { source: 'health_observation', recordId: 'other' },
    ]);
    expect(JSON.stringify(values)).toBe(original);
  },
);

test('different times, units and identical duplicates do not invent a conflict action', () => {
  const first = sample('blood_pressure_systolic', 120);
  const later = sample('blood_pressure_systolic', 110, 'mmHg', 'later');
  if (later.kind === 'health_observation')
    later.record.effectiveAt = '2035-01-01T02:00:00Z';
  expect(guidance(first, later)).toEqual([]);
  expect(
    guidance(
      first,
      sample('blood_pressure_systolic', 120, 'mmHg', 'duplicate'),
    ),
  ).toEqual([]);
  expect(
    guidance(first, sample('blood_pressure_systolic', 15, 'kPa', 'other-unit')),
  ).toEqual([]);
});

test.each([
  ['blood_pressure_systolic', 'blood pressure systolic', 145, 110],
  ['blood_pressure_diastolic', 'blood pressure diastolic', 90, 70],
])(
  'known alias pair %s and %s preserves same-instant conflict evidence',
  (underscored, spaced, high, low) => {
    const values = [
      sample(underscored, high),
      sample(spaced, low, 'mmHg', 'other'),
    ];
    const original = JSON.stringify(values);
    expect(conflictingDailyReportIndexes(values)).toEqual([0, 1]);
    const claims = guidance(...values);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.text).toContain('어느 기록이 정확한지');
    expect(claims[0]?.sourceReferences).toHaveLength(2);
    expect(JSON.stringify(values)).toBe(original);
  },
);

test('alias normalization never combines axes or converts units and leaves unknown concepts alone', () => {
  expect(
    conflictingDailyReportIndexes([
      sample('blood_pressure_systolic', 120),
      sample('blood pressure diastolic', 80, 'mmHg', 'diastolic'),
    ]),
  ).toEqual([]);
  const units = [
    sample('blood_pressure_systolic', 140),
    sample('blood pressure systolic', 18, 'kPa', 'kpa'),
  ];
  expect(conflictingDailyReportIndexes(units)).toEqual([]);
  expect(incomparableDailyReportIndexes(units)).toEqual([0, 1]);
  expect(guidance(...units)).toEqual([]);
  expect(
    conflictingDailyReportIndexes([
      sample('blood_pressure_systolic', 140),
      sample('blood-pressure-systolic', 110, 'mmHg', 'unknown'),
    ]),
  ).toEqual([]);
});

test('a severe supported alias remains urgent despite a lower conflicting record', () => {
  const claims = guidance(
    sample('blood pressure systolic', 180),
    sample('blood_pressure_systolic', 110, 'mmHg', 'other'),
  );
  expect(claims).toHaveLength(1);
  expect(claims[0]?.text).toContain('재측정을 기다리지 말고 119');
  expect(claims[0]?.text).not.toContain('어느 기록이 정확한지');
});
