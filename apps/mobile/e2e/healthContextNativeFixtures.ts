import type { HealthObservation } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';

export const contextWindow = {
  fromInclusive: '2026-09-30T15:00:00Z',
  toExclusive: '2026-10-04T15:00:00Z',
  timeZone: 'Asia/Seoul',
};

function metadata(id: string, effectiveAt: string, sensor = 'watch') {
  return {
    id,
    effectiveAt,
    recordedAt: effectiveAt,
    ingestedAt: '2026-10-20T00:00:00Z',
    provenance: {
      origin: 'imported' as const,
      sourceRecordIds: [],
      source: { system: 'healthkit', sourceIdentifier: sensor },
    },
    reviewState: { status: 'unreviewed' as const },
  };
}

function quantity(
  id: string,
  concept: string,
  effectiveAt: string,
  amount: number,
  unit: string,
  sensor?: string,
): HealthObservation {
  return {
    ...metadata(id, effectiveAt, sensor),
    observationKind: 'measurement',
    concept,
    value: { kind: 'quantity', amount, unit },
  };
}

/** Synthetic occurrence dates precede ingestion; duplicated sleep and separate step sensors must not inflate totals. */
export async function seedHealthContextNativeRecords(
  records: RecordRepository,
) {
  for (const day of [1, 3, 4]) {
    for (const [index, amount] of [120 + day, 140 + day].entries()) {
      await records.put(
        'health_observation',
        quantity(
          `bp-${day}-${index}`,
          'blood pressure systolic',
          `2026-10-0${day}T0${index}:00:00Z`,
          amount,
          'mmHg',
        ),
      );
    }
    for (const [sensor, factor] of [
      ['watch', 100],
      ['phone', 200],
    ] as const) {
      await records.put(
        'health_observation',
        quantity(
          `${sensor}-${day}`,
          'step_count',
          `2026-10-0${day}T02:00:00Z`,
          day * factor,
          'count',
          sensor,
        ),
      );
    }
  }
  await records.put(
    'health_observation',
    quantity('body-mass', 'body_mass', '2026-10-02T01:00:00Z', 70.5, 'kg'),
  );
  await records.put(
    'health_observation',
    quantity(
      'outside-period',
      'blood pressure systolic',
      '2026-10-10T01:00:00Z',
      990,
      'mmHg',
    ),
  );
  for (const [id, start, end, code] of [
    ['core', '13:00', '14:00', '3'],
    ['duplicate-core', '13:00', '14:00', '3'],
    ['deep', '13:30', '14:30', '4'],
    ['awake', '14:30', '14:40', '2'],
  ]) {
    await records.put('health_observation', {
      ...metadata(id!, `2026-10-01T${start}:00Z`),
      endedAt: `2026-10-01T${end}:00Z`,
      observationKind: 'other',
      concept: 'HKCategoryTypeIdentifierSleepAnalysis',
      value: { kind: 'text', text: code! },
    });
  }
  await records.put('medication_definition', {
    id: 'synthetic-current-medication',
    ingestedAt: '2026-10-20T00:00:00Z',
    provenance: {
      origin: 'imported',
      sourceRecordIds: [],
      source: { system: 'healthkit' },
    },
    reviewState: { status: 'unreviewed' },
    medicationConceptIdentifier: 'HealthKit.synthetic.medication',
    displayText: 'Synthetic daily medicine',
    generalForm: 'tablet',
    isArchived: false,
    hasSchedule: true,
  });
  for (const [day, observationStatus] of [
    [1, 'taken'],
    [3, 'not_logged'],
  ] as const) {
    await records.put('dose_event', {
      ...metadata(`dose-${day}`, `2026-10-0${day}T01:00:00Z`),
      eventKind: 'observed',
      medicationDefinitionId: 'synthetic-current-medication',
      observationStatus,
      scheduleType: 'scheduled',
    });
  }
  await records.put('symptom_entry', {
    ...metadata('symptom', '2026-10-03T01:00:00Z'),
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    description: 'Synthetic symptom',
    severity: 3,
  });
}
