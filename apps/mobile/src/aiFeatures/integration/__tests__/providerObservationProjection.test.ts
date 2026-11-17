import type { HealthObservation } from '@orot/domain';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceQueries';
import {
  isBulkSensorObservation,
  summarizeProviderObservations,
} from '../providerObservationProjection';

const entry = (record: HealthObservation): LocalHealthEvidenceRecord => ({
  kind: 'health_observation',
  record,
});
const sample = (
  id: string,
  amount: number,
  at: string,
  extra: Partial<HealthObservation> = {},
) =>
  entry({
    ...healthObservation(id, 'heart_rate', at),
    value: { kind: 'quantity', amount, unit: 'count/min' },
    ...extra,
  });

test('classifies typed samples across origins without classifying narrative clinical records or dose events', () => {
  const imported = sample('imported', 80, '2026-10-01T10:00:00Z');
  const manual = sample('manual', 90, '2026-10-01T10:00:00Z', {
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
  });
  expect(isBulkSensorObservation(imported)).toBe(true);
  expect(isBulkSensorObservation(manual)).toBe(true);
  for (const observationKind of [
    'diagnosis',
    'allergy',
    'procedure',
    'other',
  ] as const) {
    expect(
      isBulkSensorObservation(
        entry({
          ...healthObservation(
            observationKind,
            'clinical record',
            '2026-10-01T10:00:00Z',
          ),
          observationKind,
          value: { kind: 'text', text: 'Synthetic original narrative' },
        }),
      ),
    ).toBe(false);
  }
  expect(
    isBulkSensorObservation({
      kind: 'dose_event',
      record: {},
    } as LocalHealthEvidenceRecord),
  ).toBe(false);
  expect(
    isBulkSensorObservation({
      kind: 'symptom_entry',
      record: {},
    } as LocalHealthEvidenceRecord),
  ).toBe(false);
});

test('provides deterministic scalar summaries while keeping member IDs and raw samples out of provider content', () => {
  const samples = [
    sample('private-first', 70, '2026-10-01T10:00:00Z'),
    sample('private-middle', 85, '2026-10-01T11:00:00Z'),
    sample('private-last', 100, '2026-10-01T12:00:00Z'),
  ];
  const summaries = summarizeProviderObservations(samples);
  expect(summarizeProviderObservations([...samples].reverse())).toEqual(
    summaries,
  );
  expect(summarizeProviderObservations([...samples, samples[0]!])).toEqual(
    summaries,
  );
  expect(summaries[0]?.memberIds).toEqual([
    'private-first',
    'private-middle',
    'private-last',
  ]);
  expect(summaries[0]?.content).toMatchObject({
    version: 1,
    kind: 'sensor_period_summary',
    coverage: 'retrieved_subset',
    sampleCount: 3,
    concept: 'heart_rate',
    unit: 'count/min',
    statistics: { minimum: 70, maximum: 100, mean: 85 },
    period: {
      fromInclusive: '2026-10-01T10:00:00Z',
      toInclusive: '2026-10-01T12:00:00Z',
    },
  });
  const content = JSON.stringify(summaries[0]!.content);
  for (const forbidden of [
    'private-',
    '2026-10-01T11:00:00Z',
    'com.example.synthetic',
    'sourceIdentifier',
    'sourceRecordIds',
    'memberIds',
    '"amount"',
    '"value"',
  ])
    expect(content).not.toContain(forbidden);
  expect(summaries[0]?.content.limitations).toEqual(
    expect.arrayContaining([
      'retrieved_subset_not_complete_history',
      'descriptive_statistics_not_diagnosis',
    ]),
  );
});

test('does not merge different units, sensors, devices, or manually reported sources', () => {
  const base = healthObservation('a', 'heart_rate', '2026-10-01T10:00:00Z');
  const rows = [
    entry(base),
    entry({
      ...base,
      id: 'b',
      value: { kind: 'quantity', amount: 1, unit: 'Hz' },
    }),
    entry({
      ...base,
      id: 'c',
      provenance: {
        ...base.provenance,
        source: { system: 'healthkit', sourceIdentifier: 'private-device-2' },
      },
    }),
    entry({
      ...base,
      id: 'd',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
    }),
  ];
  const groups = summarizeProviderObservations(rows);
  expect(groups).toHaveLength(4);
  expect(groups.every(group => group.content.sampleCount === 1)).toBe(true);
  expect(JSON.stringify(groups.map(group => group.content))).not.toContain(
    'private-device-2',
  );
});

const sleep = (id: string, start: string, end: string, stage: string) =>
  entry({
    ...healthObservation(id, 'sleep', start, 'healthkit', 'imported', end),
    observationKind: 'other',
    value: { kind: 'text', text: stage },
  });

test('summarizes sleep by exact interval unions without emitting category samples or private text', () => {
  const groups = summarizeProviderObservations([
    sleep('core', '2026-10-01T22:00:00Z', '2026-10-01T23:00:00Z', '3'),
    sleep(
      'core-duplicate',
      '2026-10-01T22:00:00Z',
      '2026-10-01T23:00:00Z',
      'asleepCore',
    ),
    sleep('deep', '2026-10-01T22:30:00Z', '2026-10-01T23:30:00Z', '4'),
    sleep(
      'unsupported',
      '2026-10-01T23:30:00Z',
      '2026-10-01T23:40:00Z',
      'private-unknown-stage',
    ),
  ]);
  expect(groups[0]?.content.sleep).toEqual({
    asleepSeconds: 5400,
    coveredThroughExclusive: '2026-10-01T23:30:00Z',
    overlappingStageSeconds: 1800,
    stages: { asleepCore: 3600, asleepDeep: 3600 },
  });
  expect(groups[0]?.content.sampleCount).toBe(4);
  expect(groups[0]?.content.statistics).toBeUndefined();
  expect(groups[0]?.content.limitations).toContain(
    'unsupported_sleep_categories_excluded_from_duration',
  );
  expect(JSON.stringify(groups[0]?.content)).not.toContain(
    'private-unknown-stage',
  );
});

test('keeps unsupported workout values private and labels the unavailable numeric interpretation', () => {
  const record = healthObservation(
    'workout',
    'workout_duration',
    '2026-10-01T00:00:00Z',
  );
  const [group] = summarizeProviderObservations([
    entry({
      ...record,
      value: { kind: 'text', text: 'private raw sample text' },
    }),
  ]);
  expect(group?.content.statistics).toBeUndefined();
  expect(group?.content.limitations).toContain(
    'unsupported_sample_value_representation_not_interpreted',
  );
  expect(JSON.stringify(group?.content)).not.toContain(
    'private raw sample text',
  );
});

test('summarizes every selected sample beyond former evidence count ceilings', () => {
  const values = Array.from({ length: 128 }, (_, index) =>
    sample(`local-${index}`, index, '2026-10-01T00:00:00Z'),
  );
  const [group] = summarizeProviderObservations(values);
  expect(group?.memberIds).toHaveLength(128);
  expect(group?.content.sampleCount).toBe(128);
  expect(group?.content.limitations).toContain(
    'conflicting_values_at_same_instant',
  );
  expect(group?.content.statistics).toEqual({
    minimum: 0,
    maximum: 127,
    mean: 63.5,
  });
  expect(JSON.stringify(group?.content)).not.toContain('local-');
});
