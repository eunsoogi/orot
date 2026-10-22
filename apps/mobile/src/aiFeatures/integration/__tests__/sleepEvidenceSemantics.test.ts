import { createLocalEvidenceSnapshot } from '../evidenceSnapshot';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { presentEvidenceSource } from '../evidenceSourcePresentation';
import {
  healthObservation,
  inventory,
  repository,
  noStaleEvidence,
} from '../testSupport/personalEvidenceTestSupport';
import { HealthObservationSchema } from '@orot/domain';
import { chunkStructuredRecord } from '@orot/rag';

test('all personal evidence payloads explain step units without changing the source quantity', async () => {
  const record = HealthObservationSchema.parse({
    ...healthObservation('synthetic-steps', []).record,
    concept: 'step_count',
    effectiveAt: '2035-01-01T00:00:00Z',
    endedAt: '2035-01-01T00:05:00Z',
    value: { kind: 'quantity', amount: 233, unit: 'count' },
  });
  const records = [{ kind: 'health_observation' as const, record }];
  const persisted = chunkStructuredRecord('health_observation', record);
  const snapshot = await createLocalEvidenceSnapshot({
    records,
    inventory: inventory(records),
    persistedChunks: [persisted],
    loadCurrentPersistedChunks: async () => [persisted],
    ...noStaleEvidence,
    repository: repository(records),
    memoryRecords: [],
    memoryStorage: { listRecords: async () => [] },
    registry: new LocalEvidenceReferenceRegistry(),
  });
  expect(snapshot.items[0]?.content).toContain(persisted.text);
  expect(snapshot.items[0]?.content).toContain('steps_not_occurrences');
  expect(snapshot.items[0]?.effectiveTime).toBe('2035-01-01T00:00:00Z');
  expect(snapshot.items[0]?.content).toContain('2035-01-01T00:05:00Z');
  expect(record.value).toEqual({
    kind: 'quantity',
    amount: 233,
    unit: 'count',
  });
});

test('explains a saved HealthKit sleep category and interval without inventing a nightly total', async () => {
  const record = HealthObservationSchema.parse({
    ...healthObservation('synthetic-sleep', []).record,
    concept: 'HKCategoryTypeIdentifierSleepAnalysis',
    provenance: {
      origin: 'imported',
      sourceRecordIds: [],
      source: { system: 'healthkit' },
    },
    effectiveAt: '2035-01-01T00:00:00Z',
    endedAt: '2035-01-01T00:30:00Z',
    value: { kind: 'text', text: '3' },
  });
  const records = [{ kind: 'health_observation' as const, record }];
  const persisted = chunkStructuredRecord('health_observation', record);
  const snapshot = await createLocalEvidenceSnapshot({
    records,
    inventory: inventory(records),
    persistedChunks: [persisted],
    loadCurrentPersistedChunks: async () => [persisted],
    ...noStaleEvidence,
    repository: repository(records),
    memoryRecords: [],
    memoryStorage: { listRecords: async () => [] },
    registry: new LocalEvidenceReferenceRegistry(),
  });
  expect(snapshot.items[0]?.content).toContain('코어 수면');
  expect(snapshot.items[0]?.content).toContain('1800');
  expect(snapshot.items[0]?.content).toContain(
    'single_sample_not_nightly_total',
  );
  expect(
    presentEvidenceSource({ sourceKind: 'personal_record', records })[0]?.hero
      ?.body,
  ).toBe('코어 수면');
});
