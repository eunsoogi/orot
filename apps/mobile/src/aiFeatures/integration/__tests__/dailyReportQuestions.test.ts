import { HealthObservationSchema, SymptomEntrySchema } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceQueries';
import { dailyReportQuestions } from '../dailyReportQuestions';

const metadata = {
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
};
const measure = (
  concept: string,
  amount: number,
  unit = 'mmHg',
): LocalHealthEvidenceRecord => ({
  kind: 'health_observation',
  record: HealthObservationSchema.parse({
    ...metadata,
    id: concept,
    concept,
    observationKind: 'measurement',
    value: { kind: 'quantity', amount, unit },
    endedAt: '2035-01-01T01:00:01Z',
  }),
});
const symptom = (status: 'active' | 'resolved'): LocalHealthEvidenceRecord => ({
  kind: 'symptom_entry',
  record: SymptomEntrySchema.parse({
    ...metadata,
    id: 'symptom',
    description: '합성 증상',
    status,
    ...(status === 'resolved' ? { resolvedAt: '2035-01-01T02:00:00Z' } : {}),
  }),
});

test('personalizes questions to admitted symptoms, pressure and activity without inventing answers', () => {
  const values = [
    symptom('active'),
    measure('blood_pressure_systolic', 140),
    measure('step_count', 8, 'count'),
  ];
  const original = JSON.stringify(values);
  const questions = dailyReportQuestions(values);
  expect(questions).toHaveLength(3);
  expect(questions[0]).toContain('지금도 있나요');
  expect(questions[1]).toContain('의료진이 정한 목표');
  expect(questions[2]).toContain('실제로 활동했을 수 있어요');
  expect(JSON.stringify(values)).toBe(original);
});
test.each([
  ['blood_pressure_systolic', 180],
  ['blood pressure diastolic', 120],
])(
  'severe %s cuff intervals never delay emergency guidance with questions',
  (concept, amount) => {
    expect(
      dailyReportQuestions([
        symptom('active'),
        measure(concept, amount),
        measure('step_count', 8, 'count'),
      ]),
    ).toEqual([]);
  },
);
test('unsupported units do not trigger a severe clinical threshold', () => {
  expect(
    dailyReportQuestions([measure('blood_pressure_systolic', 180, 'kPa')]),
  ).toHaveLength(1);
});
test('resolved symptoms do not become current symptoms; unknown health is not normal', () => {
  const questions = dailyReportQuestions([symptom('resolved')]);
  expect(questions).toHaveLength(1);
  expect(questions[0]).not.toContain('지금도 있나요');
  expect(questions[0]).toContain('전체 건강의 정상·이상을 판단하지');
  expect(dailyReportQuestions([])).toEqual([]);
});
