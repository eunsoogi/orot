import { MedicationAssertionSchema } from '@orot/domain';
import { presentEvidenceSource } from '../evidenceSourcePresentation';
import { visibleValue } from '../evidenceSourceValues';

test('keeps meaningful medication instructions in the readable original without local identifiers', () => {
  const record = MedicationAssertionSchema.parse({
    id: 'private-synthetic-medication',
    effectiveAt: '2035-01-01T00:00:00Z',
    recordedAt: '2035-01-01T00:00:00Z',
    ingestedAt: '2035-01-01T00:00:00Z',
    provenance: { origin: 'clinician_recorded', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    assertionKind: 'prescribed',
    medicationName: '합성 약 이름',
    dosageInstruction: '원문에 적힌 합성 복용 안내',
    route: '원문에 적힌 합성 투여 경로',
  });
  const sections = presentEvidenceSource({
    sourceKind: 'personal_record',
    records: [{ kind: 'medication_assertion', record }],
  });
  expect(sections[0]?.rows).toEqual(
    expect.arrayContaining([
      { label: '약 이름', value: record.medicationName },
      { label: '복용 방법', value: record.dosageInstruction },
      { label: '투여 경로', value: record.route },
    ]),
  );
  expect(JSON.stringify(sections)).not.toContain(record.id);
});

test('shows normalized and original quantities together without serialization labels', () => {
  expect(
    visibleValue({
      kind: 'quantity',
      amount: 5.5,
      unit: 'mmol/L',
      sourceRepresentation: { status: 'available', amount: 99, unit: 'mg/dL' },
    }),
  ).toBe('5.5 mmol/L (출처에 기록된 값: 99 mg/dL)');
  expect(visibleValue(90000, 'recordingDurationMs')).toBe('1분 30초');
});

test('shows the measured quantity without an irrelevant original-display availability notice', () => {
  const sourceRepresentation = {
    status: 'unavailable',
    reason: 'healthkit_does_not_expose_original_display_unit',
  };
  expect(
    visibleValue({
      kind: 'quantity',
      amount: 72,
      unit: 'count/min',
      sourceRepresentation,
    }),
  ).toBe('72 count/min');
  expect(visibleValue(sourceRepresentation)).toBeUndefined();
});
