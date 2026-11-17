import type { HealthObservation } from '@orot/domain';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceQueries';
import { summarizeProviderObservations } from '../providerObservationProjection';

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

const sleep = (id: string, start: string, end: string, stage: string) =>
  entry({
    ...healthObservation(id, 'sleep', start, 'healthkit', 'imported', end),
    observationKind: 'other',
    value: { kind: 'text', text: stage },
  });

test('does not treat object prototype names as sleep categories', () => {
  const [group] = summarizeProviderObservations([
    sleep(
      'unknown',
      '2026-10-01T00:00:00Z',
      '2026-10-01T01:00:00Z',
      'constructor',
    ),
  ]);
  expect(group?.content.sleep?.asleepSeconds).toBe(0);
  expect(group?.content.sleep?.stages).toEqual({});
  expect(group?.content.limitations).toContain(
    'unsupported_sleep_categories_excluded_from_duration',
  );
});

test('preserves sub-millisecond interval ordering and rejects conflicting source identities', () => {
  const a = sleep(
    'precise',
    '2026-10-01T00:00:00.0001Z',
    '2026-10-01T00:00:00.0009Z',
    'asleepCore',
  );
  expect(
    summarizeProviderObservations([a])[0]?.content.sleep?.asleepSeconds,
  ).toBeCloseTo(0.0008, 8);
  expect(() =>
    summarizeProviderObservations([
      a,
      sleep(
        'precise',
        '2026-10-01T00:00:00.0002Z',
        '2026-10-01T00:00:00.0009Z',
        'asleepCore',
      ),
    ]),
  ).toThrow('Conflicting observation identity');
  expect(() =>
    summarizeProviderObservations([
      sample('invalid', NaN, '2026-10-01T00:00:00Z'),
    ]),
  ).toThrow('Invalid observation quantity');
});
