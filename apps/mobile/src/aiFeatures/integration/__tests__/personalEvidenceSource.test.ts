import { chunkStructuredRecord } from '@orot/rag';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildPersonalEvidence } from '../personalEvidence';
import {
  healthObservation,
  inventory,
  noStaleEvidence,
  referenceOnly,
  repository,
  sourceRecord,
} from '../testSupport/personalEvidenceTestSupport';

// Source-detail behavior is grouped separately from stale evidence checks.
describe('personal evidence source detail', () => {
  it('opens the exact saved observation and its linked source record', async () => {
    const source = sourceRecord('source-current');
    const observation = healthObservation(
      'observation-current',
      ['source-current'],
      70.5,
    );
    let currentRecords = [source, observation];
    const currentRepository = repository(currentRecords);
    jest
      .mocked(currentRepository.readRecord)
      .mockImplementation(
        async (kind, id) =>
          currentRecords.find(
            record => record.kind === kind && record.record.id === id,
          )?.record ?? null,
      );
    const chunk = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );
    const registry = new LocalEvidenceReferenceRegistry();
    const result = buildPersonalEvidence({
      inventory: inventory(currentRecords),
      persistedChunks: [chunk],
      repository: currentRepository,
      registry,
      loadCurrentPersistedChunks: async () => [chunk],
      ...noStaleEvidence,
    });
    const item = result.items[0];
    if (!item) throw new Error('Expected the current observation fixture.');

    await expect(
      registry.readSource(referenceOnly(item), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'available',
      document: {
        sourceKind: 'personal_record',
        records: [
          {
            kind: 'health_observation',
            record: {
              effectiveAt: '2026-01-02T08:00:00.000Z',
              value: { kind: 'quantity', amount: 70.5, unit: 'kg' },
            },
          },
          { kind: 'source_record', record: { sourceKind: 'user_note' } },
        ],
      },
    });

    currentRecords = [observation];
    await expect(
      registry.readSource(referenceOnly(item), new AbortController().signal),
    ).resolves.toEqual({ status: 'missing' });
    currentRecords = [source];
    await expect(
      registry.readSource(referenceOnly(item), new AbortController().signal),
    ).resolves.toEqual({ status: 'missing' });
  });

  it('marks a changed observation as stale instead of showing old values', async () => {
    const source = sourceRecord('source-current');
    const observation = healthObservation(
      'observation-current',
      ['source-current'],
      70.5,
    );
    let currentRecords = [source, observation];
    const currentRepository = repository(currentRecords);
    jest
      .mocked(currentRepository.readRecord)
      .mockImplementation(
        async (kind, id) =>
          currentRecords.find(
            record => record.kind === kind && record.record.id === id,
          )?.record ?? null,
      );
    const chunk = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );
    const registry = new LocalEvidenceReferenceRegistry();
    const result = buildPersonalEvidence({
      inventory: inventory(currentRecords),
      persistedChunks: [chunk],
      repository: currentRepository,
      registry,
      loadCurrentPersistedChunks: async () => [chunk],
      ...noStaleEvidence,
    });
    const item = result.items[0];
    if (!item) throw new Error('Expected the current observation fixture.');
    currentRecords = [
      source,
      healthObservation('observation-current', ['source-current'], 71),
    ];

    await expect(
      registry.readSource(referenceOnly(item), new AbortController().signal),
    ).resolves.toEqual({ status: 'changed' });
  });

  it('discards a row when it changes after the detail read but before final validation', async () => {
    const source = sourceRecord('source-current');
    const observation = healthObservation(
      'observation-current',
      ['source-current'],
      70.5,
    );
    const changed = healthObservation(
      'observation-current',
      ['source-current'],
      71,
    );
    let reads = 0;
    const liveRepository = repository([source, observation]);
    jest
      .mocked(liveRepository.readRecord)
      .mockImplementation(async (kind, id) => {
        reads += 1;
        const current = reads < 3 ? [source, observation] : [source, changed];
        return (
          current.find(
            record => record.kind === kind && record.record.id === id,
          )?.record ?? null
        );
      });
    const chunk = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );
    const registry = new LocalEvidenceReferenceRegistry();
    const result = buildPersonalEvidence({
      inventory: inventory([source, observation]),
      persistedChunks: [chunk],
      repository: liveRepository,
      registry,
      loadCurrentPersistedChunks: async () => [chunk],
      ...noStaleEvidence,
    });
    const item = result.items[0];
    if (!item) throw new Error('Expected the current observation fixture.');

    await expect(
      registry.readSource(referenceOnly(item), new AbortController().signal),
    ).resolves.toEqual({ status: 'changed' });
  });
});
