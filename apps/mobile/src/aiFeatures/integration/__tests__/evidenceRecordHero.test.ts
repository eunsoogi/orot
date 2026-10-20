import {
  DoseEventSchema,
  HealthObservationSchema,
  MedicationDefinitionSchema,
  SymptomEntrySchema,
} from '@orot/domain';
import { presentEvidenceSource } from '../evidenceSourcePresentation';
import { visibleValue } from '../evidenceSourceValues';

const base = {
  id: 'synthetic-private-record',
  effectiveAt: '2035-01-01T00:00:00Z',
  recordedAt: '2035-01-01T00:05:00Z',
  ingestedAt: '2035-01-01T00:05:00Z',
  provenance: {
    origin: 'imported',
    sourceRecordIds: [],
    source: { system: 'healthkit', sourceName: '합성 출처' },
  },
  reviewState: { status: 'unreviewed' },
};

test.each([
  ['blood pressure systolic', '수축기 혈압', 120, 'mmHg', '120 mmHg'],
  ['heart_rate', '심박수', 72, 'count/min', '72 회/분'],
  ['step_count', '걸음 수', 1234, 'count', '1234 걸음'],
  ['body_mass', '체중', 64.25, 'kg', '64.25 kg'],
  [
    '원문에 적힌 검사 항목',
    '원문에 적힌 검사 항목',
    5.75,
    'mmol/L',
    '5.75 mmol/L',
  ],
])(
  'uses the same source card for %s without inference or unit loss',
  (concept, heading, amount, unit, display) => {
    const record = HealthObservationSchema.parse({
      ...base,
      observationKind: 'measurement',
      concept,
      value: {
        kind: 'quantity',
        amount,
        unit,
        sourceRepresentation: {
          status: 'unavailable',
          reason: 'healthkit_does_not_expose_original_display_unit',
        },
      },
    });
    const card = presentEvidenceSource({
      sourceKind: 'personal_record',
      records: [{ kind: 'health_observation', record }],
    })[0]!;
    expect(card.hero).toMatchObject({ heading, value: display });
    expect(card.rows).toContainEqual({ label: '출처', value: '합성 출처' });
    expect(JSON.stringify(card)).not.toContain(base.id);
    expect(JSON.stringify(card)).not.toContain('healthkit_does_not_expose');
  },
);

test('preserves a sleep record’s saved text and interval without inventing a duration or average', () => {
  const record = HealthObservationSchema.parse({
    ...base,
    observationKind: 'other',
    concept: 'sleep',
    endedAt: '2035-01-01T06:30:00Z',
    value: { kind: 'text', text: '저장된 수면 구간' },
  });
  const card = presentEvidenceSource({
    sourceKind: 'personal_record',
    records: [{ kind: 'health_observation', record }],
  })[0]!;
  expect(card.hero?.body).toBe('저장된 수면 구간');
  expect(card.hero?.value).toBeUndefined();
  expect(card.rows.some(row => row.label === '종료 시각')).toBe(true);
});

test('shows source measurement time and provenance without import-management metadata', () => {
  const record = HealthObservationSchema.parse({
    ...base,
    recordedAt: '2035-01-02T00:00:00Z',
    ingestedAt: '2035-02-01T00:00:00Z',
    observationKind: 'measurement',
    concept: 'heart_rate',
    value: {
      kind: 'quantity',
      amount: 72,
      unit: 'count/min',
      sourceRepresentation: {
        status: 'unavailable',
        reason: 'healthkit_does_not_expose_original_display_unit',
      },
    },
  });
  const card = presentEvidenceSource({
    sourceKind: 'personal_record',
    records: [{ kind: 'health_observation', record }],
  })[0]!;
  expect(card.hero?.at).toBe(visibleValue(base.effectiveAt, 'effectiveAt'));
  expect(
    card.rows.filter(row => !card.hero?.consumedLabels.includes(row.label)),
  ).toEqual([{ label: '출처', value: '합성 출처' }]);
});

test('preserves symptom text verbatim rather than generating a record-original paragraph', () => {
  const record = SymptomEntrySchema.parse({
    ...base,
    description: '합성 증상 메모\n기록자가 입력한 두 번째 줄',
    severity: 4,
  });
  const card = presentEvidenceSource({
    sourceKind: 'personal_record',
    records: [{ kind: 'symptom_entry', record }],
  })[0]!;
  expect(card.hero?.body).toBe(record.description);
  expect(card.rows).toContainEqual({ label: '정도', value: '4' });
});

test('keeps a meaningful time-zone identifier while hiding opaque linkage identifiers', () => {
  expect(
    visibleValue({
      timeZoneIdentifier: 'Asia/Seoul',
      privateIdentifier: 'private-id',
    }),
  ).toBe('일정 시간대: Asia/Seoul');
});

test.each([
  ['taken', '복용 발생 시각'],
  ['skipped', '복약 기록 시각'],
  ['unknown', '복약 기록 시각'],
] as const)(
  'uses the actual dose event time for %s without substituting import time',
  (observationStatus, atLabel) => {
    const record = DoseEventSchema.parse({
      ...base,
      eventKind: 'observed',
      medicationDefinitionId: 'synthetic-medication',
      observationStatus,
      dose: { amount: 1, unit: '정' },
    });
    const card = presentEvidenceSource({
      sourceKind: 'personal_record',
      records: [{ kind: 'dose_event', record }],
    })[0]!;
    expect(card.hero).toMatchObject({
      at: visibleValue(base.effectiveAt, 'effectiveAt'),
      atLabel,
      value: '1 정',
    });
  },
);

test('never presents medication catalog import time as a dose occurrence', () => {
  const record = MedicationDefinitionSchema.parse({
    id: base.id,
    ingestedAt: base.ingestedAt,
    provenance: base.provenance,
    reviewState: base.reviewState,
    medicationConceptIdentifier: 'synthetic-concept',
    displayText: '예시약',
    generalForm: 'tablet',
    isArchived: false,
    hasSchedule: true,
  });
  const card = presentEvidenceSource({
    sourceKind: 'personal_record',
    records: [{ kind: 'medication_definition', record }],
  })[0]!;
  expect(card.hero?.at).toBeUndefined();
  expect(card.hero?.heading).toBe('예시약');
  expect(card.rows).toEqual([
    { label: '표시 이름', value: '예시약' },
    { label: '출처', value: '합성 출처' },
  ]);
});
