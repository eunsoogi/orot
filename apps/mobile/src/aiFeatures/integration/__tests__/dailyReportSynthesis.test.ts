import { HealthObservationSchema, SymptomEntrySchema } from '@orot/domain';
import type { DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceQueries';
import { dailyReportSynthesis } from '../dailyReportSynthesis';

const metadata = (id: string, hour = '01') => ({
  id,
  effectiveAt: `2035-01-01T${hour}:00:00Z`,
  recordedAt: '2035-01-01T12:00:00Z',
  ingestedAt: '2035-01-01T12:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
});
const measurement = (
  id: string,
  amount: number,
  hour = '01',
  unit = 'count/min',
): LocalHealthEvidenceRecord => ({
  kind: 'health_observation',
  record: HealthObservationSchema.parse({
    ...metadata(id, hour),
    observationKind: 'measurement',
    concept: 'heart_rate',
    value: { kind: 'quantity', amount, unit },
  }),
});
const sources = (
  values: LocalHealthEvidenceRecord[],
): DailyReportSourceRecord[] =>
  values.map(value => ({
    source: value.kind,
    recordId: value.record.id,
    revision: '1',
    occurrence: { startInclusive: value.record.effectiveAt! },
    ingestedAt: value.record.ingestedAt,
  }));
const summarize = (values: LocalHealthEvidenceRecord[]) =>
  dailyReportSynthesis(values, sources(values), [0]);

test('synthesizes chronological measurements rather than counting records or making medical judgments', () => {
  const result = summarize([
    measurement('late', 90, '09'),
    measurement('early', 70),
  ]);
  expect(result[0]?.text).toContain(
    '첫 기록 70 회/분에서 마지막 기록 90 회/분로 높아졌어요',
  );
  expect(result[0]?.text).toContain(
    '건강이 좋아지거나 나빠졌다는 의미로 해석하지 않았어요',
  );
  expect(result[0]?.sourceReferences.map(ref => ref.recordId)).toEqual([
    'early',
    'late',
  ]);
});
test('single and empty samples do not invent baselines or reassurance', () => {
  expect(summarize([])).toEqual([]);
  expect(summarize([measurement('only', 72)])[0]?.text).toContain(
    '하루 동안의 변화는 알 수 없어요',
  );
});
test('equal endpoints do not claim an unobserved stable day', () => {
  const result = summarize([
    measurement('a', 72),
    measurement('b', 99, '05'),
    measurement('c', 72, '09'),
  ]);
  expect(result[0]?.text).toContain('중간 값까지 일정했다는 뜻은 아니에요');
});
test('conflicting same-time readings are not interpreted as trends', () => {
  const result = summarize([
    measurement('a', 70),
    measurement('b', 90),
    measurement('c', 80, '09'),
  ]);
  expect(result[0]?.text).toContain('변화 방향을 판단하지 않았어요');
  expect(result[0]?.sourceReferences).toHaveLength(3);
});
test('different units do not create a comparison', () => {
  const result = summarize([
    measurement('a', 70),
    measurement('b', 1.2, '09', 'count/s'),
  ]);
  expect(result).toHaveLength(2);
  expect(result.every(item => item.text.includes('변화는 알 수 없어요'))).toBe(
    true,
  );
});
test('distinguishes reported active and resolved symptoms without inventing their cause', () => {
  const values: LocalHealthEvidenceRecord[] = [
    {
      kind: 'symptom_entry',
      record: SymptomEntrySchema.parse({
        ...metadata('active'),
        description: '합성 두통',
        status: 'active',
      }),
    },
    {
      kind: 'symptom_entry',
      record: SymptomEntrySchema.parse({
        ...metadata('resolved'),
        description: '합성 메스꺼움',
        status: 'resolved',
        resolvedAt: '2035-01-01T09:00:00Z',
      }),
    },
  ];
  const result = summarize(values);
  expect(result[0]?.text).toContain('‘합성 두통’ 증상이 지속 중');
  expect(result[0]?.text).toContain(
    '‘합성 메스꺼움’ 증상은 해소된 것으로 기록',
  );
  expect(result[0]?.text).toContain('현재 상태나 원인');
  expect(result[0]?.sourceReferences).toHaveLength(2);
});
test('rejects a source identity mismatch', () => {
  const values = [measurement('a', 72)];
  expect(() =>
    dailyReportSynthesis(
      values,
      [{ ...sources(values)[0]!, recordId: 'other' }],
      [0],
    ),
  ).toThrow('Snapshot source mismatch');
});
