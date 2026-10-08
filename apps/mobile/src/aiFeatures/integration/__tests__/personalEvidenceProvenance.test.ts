import { createTranscriptCorrection } from '@orot/domain';
import { chunkStructuredRecord, chunkTranscriptSegment } from '@orot/rag';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildPersonalEvidence } from '../personalEvidence';
import {
  entry,
  healthObservation,
  inventory,
  noStaleEvidence,
  referenceOnly,
  repository,
  sourceRecord,
  structuredChunk,
} from '../testSupport/personalEvidenceTestSupport';

async function revalidate(input: {
  readonly records: ReturnType<typeof sourceRecord>[];
  readonly currentRecords?: ReturnType<typeof sourceRecord>[];
  readonly chunks: ReturnType<typeof chunkStructuredRecord>[];
}) {
  const registry = new LocalEvidenceReferenceRegistry();
  const result = buildPersonalEvidence({
    inventory: inventory(input.records),
    persistedChunks: input.chunks,
    repository: repository(input.currentRecords ?? input.records),
    registry,
    loadCurrentPersistedChunks: async () => input.chunks,
    ...noStaleEvidence,
  });
  const item = result.items[0];
  if (!item) throw new Error('Expected a personal evidence fixture.');
  return registry.revalidateEvidence(
    [referenceOnly(item)],
    new AbortController().signal,
  );
}

describe('personal evidence provenance', () => {
  it('accepts an unlinked observation whose retrieval source is the observation itself', async () => {
    const observation = healthObservation('observation-unlinked', []);
    const chunk = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );

    await expect(
      revalidate({ records: [observation], chunks: [chunk] }),
    ).resolves.toBe(true);
  });

  it('accepts HealthKit provenance IDs that identify external samples', async () => {
    const base = healthObservation('observation-healthkit', [
      'healthkit-sample-id',
    ]);
    const observation = entry('health_observation', {
      ...(base.record as object),
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['healthkit-sample-id'],
        source: { system: 'healthkit' },
      },
    });
    const chunk = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );

    await expect(
      revalidate({ records: [observation], chunks: [chunk] }),
    ).resolves.toBe(true);
  });

  it('validates a source record that shares an ID with its observation', async () => {
    const source = sourceRecord('shared-id');
    const observation = healthObservation('shared-id', ['shared-id']);
    const chunk = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );

    await expect(
      revalidate({ records: [source, observation], chunks: [chunk] }),
    ).resolves.toBe(true);
  });

  it('rejects a changed source record that shares an ID with its observation', async () => {
    const source = sourceRecord('shared-id');
    const changedSource = entry('source_record', {
      ...(source.record as object),
      sourceKind: 'audio_recording',
    });
    const observation = healthObservation('shared-id', ['shared-id']);
    const chunk = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );

    await expect(
      revalidate({
        records: [source, observation],
        currentRecords: [changedSource, observation],
        chunks: [chunk],
      }),
    ).resolves.toBe(false);
  });

  it('rejects a deleted source record that shares an ID with its observation', async () => {
    const source = sourceRecord('shared-id');
    const observation = healthObservation('shared-id', ['shared-id']);
    const chunk = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );

    await expect(
      revalidate({
        records: [source, observation],
        currentRecords: [observation],
        chunks: [chunk],
      }),
    ).resolves.toBe(false);
  });

  it('accepts a corrected transcript when its provenance includes an earlier segment', async () => {
    const at = '2026-01-02T08:00:00.000Z';
    const recording = entry('source_record', {
      id: 'recording-source',
      sourceKind: 'audio_recording',
      effectiveAt: at,
      recordedAt: at,
      ingestedAt: at,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
    const original = entry('transcript_segment', {
      id: 'transcript-two:r1',
      transcriptId: 'transcript-two',
      recordingSourceId: 'recording-source',
      segmentOrdinal: 0,
      revision: 1,
      text: 'Original words.',
      language: 'en-US',
      recordingDurationMs: 5000,
      audioRange: { startMs: 0, endMs: 2500 },
      effectiveAt: at,
      recordedAt: at,
      ingestedAt: at,
      provenance: {
        origin: 'derived',
        sourceRecordIds: ['recording-source'],
        source: {
          system: 'fixture',
          sourceIdentifier: 'engine',
          sourceVersion: '1',
        },
      },
      reviewState: { status: 'unreviewed' },
    });
    const correction = createTranscriptCorrection(
      original.record as never,
      'Corrected words.',
      '2026-01-02T08:10:00.000Z',
    );
    const corrected = entry('transcript_segment', correction);
    const chunk = chunkTranscriptSegment(correction);
    const registry = new LocalEvidenceReferenceRegistry();
    const records = [recording, original, corrected];
    const result = buildPersonalEvidence({
      inventory: inventory(records),
      persistedChunks: [chunk],
      repository: repository(records),
      registry,
      loadCurrentPersistedChunks: async () => [chunk],
      ...noStaleEvidence,
    });
    const item = result.items[0];
    if (!item) throw new Error('Expected the corrected transcript fixture.');

    await expect(
      registry.revalidateEvidence(
        [referenceOnly(item)],
        new AbortController().signal,
      ),
    ).resolves.toBe(true);
  });

  it('rejects a genuinely missing provenance record', async () => {
    const observation = healthObservation('observation-missing', [
      'missing-source',
    ]);
    const chunk = structuredChunk({
      id: 'observation-missing-chunk',
      recordId: 'observation-missing',
      sourceId: 'missing-source',
      sourceRecordIds: ['missing-source'],
      text: 'health_observation: current value',
    });

    await expect(
      revalidate({ records: [observation], chunks: [chunk] as never[] }),
    ).resolves.toBe(false);
  });
});
