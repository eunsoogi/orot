import { createTranscriptCorrection } from '@orot/domain';
import { chunkStructuredRecord, chunkTranscriptSegment } from '@orot/rag';
import type { EvidenceChunk } from '@orot/rag';
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
} from '../testSupport/personalEvidenceTestSupport';

describe('personal evidence freshness', () => {
  it('rejects persisted text that no longer matches the current structured record', async () => {
    const source = sourceRecord('source-current');
    const observation = healthObservation(
      'observation-current',
      ['source-current'],
      70.5,
    );
    const currentChunk = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );
    const staleChunk = {
      ...currentChunk,
      text: 'health_observation: {"value":{"amount":10,"unit":"kg"}}',
    };
    const records = [source, observation];
    const registry = new LocalEvidenceReferenceRegistry();
    const input = {
      inventory: inventory(records),
      persistedChunks: [staleChunk],
      repository: repository(records),
      registry,
      loadCurrentPersistedChunks: async () => [currentChunk],
      ...noStaleEvidence,
    };

    const result = buildPersonalEvidence(input);
    const item = result.items[0];
    if (!item) throw new Error('Expected the current observation fixture.');
    await expect(
      registry.revalidateEvidence(
        [referenceOnly(item)],
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });

  it('rejects an old transcript after a newer correction replaces its chunk', async () => {
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
      id: 'transcript-one:r1',
      transcriptId: 'transcript-one',
      recordingSourceId: 'recording-source',
      segmentOrdinal: 0,
      revision: 1,
      text: 'The old wording is here.',
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
    const corrected = createTranscriptCorrection(
      original.record as never,
      'The corrected wording is here.',
      '2026-01-02T08:10:00.000Z',
    );
    const oldChunk = chunkTranscriptSegment(original.record as never);
    const currentChunk = chunkTranscriptSegment(corrected);
    const records = [recording, original];
    const registry = new LocalEvidenceReferenceRegistry();
    const input = {
      inventory: inventory(records),
      persistedChunks: [oldChunk],
      repository: repository(records),
      registry,
      ...noStaleEvidence,
      // This second read represents a correction saved after the initial inventory was captured.
      loadCurrentPersistedChunks: async (): Promise<
        readonly EvidenceChunk[]
      > => [currentChunk],
    };

    const result = buildPersonalEvidence(input);
    const item = result.items[0];
    if (!item) throw new Error('Expected the initial transcript fixture.');
    await expect(
      registry.revalidateEvidence(
        [referenceOnly(item)],
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });
});
