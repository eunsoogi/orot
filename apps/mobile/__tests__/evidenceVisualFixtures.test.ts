import { DoseEventSchema, HealthObservationSchema } from '@orot/domain';
import { evidenceVisualRecords } from '../e2e/evidenceVisualFixtures';
import { evidenceVisualPeriod } from '../e2e/evidenceVisualPeriod';
import { presentEvidenceSource } from '../src/aiFeatures/integration/evidenceSourcePresentation';
import { parseHealthContextScope } from '../src/healthEvidence/healthContext/scope';
import { evidenceRecordHero } from '../src/aiFeatures/integration/evidenceRecordHero';

test('visual evidence uses domain-valid events with distinct occurrence and import times', () => {
  for (const entry of Object.values(evidenceVisualRecords)) {
    const schema =
      entry.kind === 'dose_event' ? DoseEventSchema : HealthObservationSchema;
    expect(schema.safeParse(entry.record).success).toBe(true);
    expect(entry.record.effectiveAt).not.toBe(entry.record.ingestedAt);
  }
});

test('the fixture exercises medication, measurement, activity and categorical sleep presentation', () => {
  expect(evidenceRecordHero(evidenceVisualRecords.medication)).toMatchObject({
    value: '1 정',
    atLabel: '복용 발생 시각',
  });
  expect(evidenceRecordHero(evidenceVisualRecords.measurement)).toMatchObject({
    value: '70.5 kg',
    atLabel: '측정 시각',
  });
  expect(evidenceRecordHero(evidenceVisualRecords.activity)).toMatchObject({
    value: '2400 걸음',
  });
  expect(evidenceRecordHero(evidenceVisualRecords.sleep)).toMatchObject({
    body: '코어 수면',
    atLabel: '측정 시작 시각',
  });
});

test('period evidence displays explicit dates and measured facts without an AI-written original', () => {
  expect(parseHealthContextScope(evidenceVisualPeriod.scope)).toEqual(
    evidenceVisualPeriod.scope,
  );
  const sections = presentEvidenceSource(evidenceVisualPeriod);
  expect(sections[0]).toMatchObject({
    title: '집계 기간',
    rows: expect.arrayContaining([
      { label: '기간', value: '2026-10-01 ~ 2026-10-03' },
    ]),
  });
  expect(sections.map(section => section.title)).toEqual([
    '집계 기간',
    '심박수 · 측정 출처 1',
    '체중 · 측정 출처 2',
  ]);
  expect(JSON.stringify(sections)).toContain('70.5 kg');
  expect(JSON.stringify(sections)).not.toContain('앱 저장 시각');
});
