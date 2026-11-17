import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceRepository';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { summarizeProviderObservations } from '../providerObservationProjection';
import { validateColdObservationPolicy } from '../coldObservationPolicy';
import { providerJsonContent } from '../providerObservationEvidence';

const rows: LocalHealthEvidenceRecord[] = [0, 1].map(index => ({
  kind: 'health_observation',
  record: healthObservation(
    `sample-${index}`,
    'heart_rate',
    `2026-10-01T0${index}:00:00Z`,
  ),
}));
function fixture(records = rows) {
  const registry = new LocalEvidenceReferenceRegistry();
  let available = true;
  const register = (content: string) =>
    registry.add({
      reference: {
        sourceKind: 'personal_record',
        sourceId: 'source',
        sourceRevision: 'revision',
        evidenceId: 'record',
        evidenceRevision: 'revision',
        locator: { kind: 'health_overview' },
        effectiveTime: null,
        reviewState: 'unknown',
      },
      content,
      readSource: async () =>
        available
          ? {
              status: 'available',
              document: { sourceKind: 'personal_record', records },
            }
          : { status: 'missing' },
      validate: async () => available,
    });
  return {
    registry,
    register,
    remove: () => {
      available = false;
    },
  };
}
const signal = () => new AbortController().signal;

test('rejects protected legacy sample payloads before any model replay', async () => {
  const { registry, register } = fixture();
  const raw = register(`health_observation: ${JSON.stringify(rows)}`);
  await expect(
    validateColdObservationPolicy([raw], registry, signal()),
  ).rejects.toThrow('new locally summarized request');
});

test('accepts only recomputed summaries, not a summary marker with appended raw samples', async () => {
  const { registry, register, remove } = fixture();
  const summary = summarizeProviderObservations(rows)[0]!.content;
  const safe = {
    ...register(''),
    content: providerJsonContent(registry, summary, 'sensor_period_summary: '),
  };
  await expect(
    validateColdObservationPolicy([safe], registry, signal()),
  ).resolves.toBeUndefined();
  const spoof = register(
    `sensor_period_summary: ${JSON.stringify({ ...summary, samples: rows })}`,
  );
  await expect(
    validateColdObservationPolicy([spoof], registry, signal()),
  ).rejects.toThrow();
  remove();
  await expect(
    validateColdObservationPolicy([safe], registry, signal()),
  ).rejects.toThrow('unavailable');
});

test('does not transform a narrative diagnosis or treat every health observation as a time series', async () => {
  const records: LocalHealthEvidenceRecord[] = [
    {
      kind: 'health_observation',
      record: {
        ...healthObservation(
          'diagnosis',
          'clinical-diagnosis',
          '2026-10-01T00:00:00Z',
        ),
        observationKind: 'diagnosis',
        value: { kind: 'text', text: 'Synthetic narrative remains unchanged.' },
      },
    },
  ];
  const { registry, register } = fixture(records);
  const item = register('Synthetic narrative remains unchanged.');
  await expect(
    validateColdObservationPolicy([item], registry, signal()),
  ).resolves.toBeUndefined();
  expect(item.content).toBe('Synthetic narrative remains unchanged.');
});

// Identifier aliases must not replace a numeric statistic with text during replay.
test('revalidates typed summary numbers even when a local ID equals the numeric value', async () => {
  const { registry, register } = fixture();
  registry.registerSensitiveIdentifier('72');
  const summary = summarizeProviderObservations(rows)[0]!.content;
  const item = {
    ...register(''),
    content: providerJsonContent(registry, summary, 'sensor_period_summary: '),
  };
  await expect(
    validateColdObservationPolicy([item], registry, signal()),
  ).resolves.toBeUndefined();
  expect(
    JSON.parse(item.content.slice('sensor_period_summary: '.length)).statistics
      .mean,
  ).toBe(72);
});

test('does not hide linked raw sensors behind a selected narrative source', async () => {
  const primary: LocalHealthEvidenceRecord = {
    kind: 'health_observation',
    record: {
      ...healthObservation('record', 'diagnosis', '2026-10-01T00:00:00Z'),
      observationKind: 'diagnosis',
      value: { kind: 'text', text: 'Clinical narrative' },
    },
  };
  const { registry, register } = fixture([primary, ...rows]);
  const item = register(JSON.stringify({ source: [primary, ...rows] }));
  await expect(
    validateColdObservationPolicy([item], registry, signal()),
  ).rejects.toThrow('new locally summarized request');
});

test('retains a protected group ordinal when validating one member group from a larger retrieval', async () => {
  const other: LocalHealthEvidenceRecord = {
    kind: 'health_observation',
    record: {
      ...healthObservation(
        'second-device',
        'heart_rate',
        '2026-10-01T00:00:00Z',
      ),
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
    },
  };
  const groups = summarizeProviderObservations([...rows, other]);
  const chosen = groups.find(group =>
    group.memberIds.includes('second-device'),
  )!;
  const { registry, register } = fixture([other]);
  const item = {
    ...register(''),
    content: providerJsonContent(
      registry,
      chosen.content,
      'sensor_period_summary: ',
    ),
  };
  await expect(
    validateColdObservationPolicy([item], registry, signal()),
  ).resolves.toBeUndefined();
});
