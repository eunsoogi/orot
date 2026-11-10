import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createManualHistoryEntry } from '@orot/domain';
import { classifyOriginalCondition } from '../conditionStatus';

const observation = healthObservation(
  'diagnosis',
  'example',
  '2026-10-01T01:00:00Z',
);

test('diagnosis source attribution does not assert the truth of its value', () => {
  const diagnosis = { ...observation, observationKind: 'diagnosis' as const };
  expect(
    classifyOriginalCondition({ kind: 'observation', record: diagnosis }),
  ).toBe('unavailable');
  expect(
    classifyOriginalCondition({
      kind: 'observation',
      record: {
        ...diagnosis,
        provenance: { origin: 'clinician_recorded', sourceRecordIds: [] },
      },
    }),
  ).toBe('clinician_attributed');
  expect(
    classifyOriginalCondition({
      kind: 'observation',
      record: {
        ...diagnosis,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
      },
    }),
  ).toBe('user_attributed');
  expect(
    classifyOriginalCondition({
      kind: 'observation',
      record: {
        ...diagnosis,
        value: { kind: 'boolean', value: false },
        provenance: { origin: 'clinician_recorded', sourceRecordIds: [] },
      },
    }),
  ).toBe('clinician_attributed');
  expect(
    classifyOriginalCondition({ kind: 'observation', record: observation }),
  ).toBe('unavailable');
});

test('manual diagnosis history remains a user report, while medication context is not a diagnosis', () => {
  const record = createManualHistoryEntry({
    id: 'synthetic',
    kind: 'diagnosis_history',
    title: 'Example',
    details: 'Example',
    effectiveDate: { status: 'unknown' },
    recordedAt: '2026-10-01T01:00:00Z',
  });
  expect(classifyOriginalCondition({ kind: 'manual_history', record })).toBe(
    'user_attributed',
  );
  expect(
    classifyOriginalCondition({
      kind: 'manual_history',
      record: { ...record, kind: 'medication_context' },
    }),
  ).toBe('unavailable');
});
