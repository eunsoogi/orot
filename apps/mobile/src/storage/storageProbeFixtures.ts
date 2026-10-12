import type { RecordMap } from '@orot/storage';

const sampleRecord = {
  id: 'storage-e2e-record',
  effectiveAt: '2026-01-01T00:00:00Z',
  recordedAt: '2026-01-01T00:00:00Z',
  ingestedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
  title: 'Synthetic storage probe',
  contentHash: 'sha256:' + 'c'.repeat(64),
} satisfies RecordMap['source_record'];

const sampleEvidenceSpan = {
  id: 'storage-e2e-evidence',
  effectiveAt: '2026-01-01T00:00:00Z',
  recordedAt: '2026-01-01T00:00:00Z',
  ingestedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'imported', sourceRecordIds: [sampleRecord.id] },
  reviewState: { status: 'unreviewed' },
  sourceRecordId: sampleRecord.id,
  text: 'Synthetic storage evidence excerpt.',
  locator: { kind: 'text_range', startOffset: 0, endOffset: 35 },
} satisfies RecordMap['evidence_span'];

// These synthetic records exercise local SQLite chunking without reading external health data.
const ragBaseTime = '2026-01-02T08:00:00.000Z';
type SyntheticOrigin = RecordMap['source_record']['provenance']['origin'];

// Shared timestamps keep the synthetic repository records internally consistent.
function syntheticMetadata(
  id: string,
  origin: SyntheticOrigin,
  ...sourceIds: string[]
) {
  return {
    id,
    effectiveAt: ragBaseTime,
    recordedAt: ragBaseTime,
    ingestedAt: ragBaseTime,
    provenance: { origin, sourceRecordIds: sourceIds },
    reviewState: { status: 'unreviewed' as const },
  };
}

const ragMedicationText = 'Metformin 500 mg once daily after breakfast.';
const ragMedicationSpan = {
  ...syntheticMetadata(
    'rag-e2e-medication-span',
    'user_reported',
    sampleRecord.id,
  ),
  sourceRecordId: sampleRecord.id,
  text: ragMedicationText,
  locator: {
    kind: 'text_range',
    startOffset: 0,
    endOffset: ragMedicationText.length,
  },
} satisfies RecordMap['evidence_span'];

const ragAudioSourceRecord = {
  ...syntheticMetadata('rag-e2e-recording-source', 'user_reported'),
  sourceKind: 'audio_recording',
  title: 'Synthetic RAG transcript recording',
  contentHash: 'sha256:' + 'e'.repeat(64),
} satisfies RecordMap['source_record'];

const ragTranscript = {
  ...syntheticMetadata(
    'rag-e2e-transcript:segment:0:r1',
    'derived',
    ragAudioSourceRecord.id,
  ),
  transcriptId: 'rag-e2e-transcript:segment:0',
  recordingSourceId: ragAudioSourceRecord.id,
  segmentOrdinal: 0,
  revision: 1,
  text: 'Metformin 250 mg before breakfast.',
  language: 'en-US',
  recordingDurationMs: 5000,
  audioRange: { startMs: 250, endMs: 1800 },
  effectiveAt: '2026-01-02T08:00:00.250Z',
  recordedAt: '2026-01-02T08:01:00.000Z',
  ingestedAt: '2026-01-02T08:01:00.000Z',
  provenance: {
    origin: 'derived',
    sourceRecordIds: [ragAudioSourceRecord.id],
    source: {
      system: 'Synthetic RAG probe',
      sourceIdentifier: 'fixture-transcriber',
      sourceVersion: '1',
    },
  },
} satisfies RecordMap['transcript_segment'];

const staleTranscriptSpan = {
  ...syntheticMetadata(
    'rag-e2e-stale-transcript-span',
    'derived',
    ragAudioSourceRecord.id,
    ragTranscript.id,
  ),
  effectiveAt: ragTranscript.effectiveAt,
  recordedAt: ragTranscript.recordedAt,
  ingestedAt: ragTranscript.ingestedAt,
  sourceRecordId: ragAudioSourceRecord.id,
  text: ragTranscript.text,
  locator: { kind: 'audio_time_range', startMs: 250, endMs: 1800 },
} satisfies RecordMap['evidence_span'];

const ragObservation = {
  ...syntheticMetadata('rag-e2e-observation', 'imported', sampleRecord.id),
  observationKind: 'measurement',
  concept: 'weight',
  value: { kind: 'quantity', amount: 70.5, unit: 'kg' },
} satisfies RecordMap['health_observation'];

const defaults = {
  sampleRecord,
  sampleEvidenceSpan,
  ragMedicationSpan,
  ragAudioSourceRecord,
  ragTranscript,
  staleTranscriptSpan,
  ragObservation,
};

/** Every scenario owns its fixture IDs; another test's stored rows must not satisfy or block a fresh phase. */
export function createStorageProbeFixtures(
  identifier?: string,
): typeof defaults {
  if (identifier === undefined) return defaults;
  if (
    !/^test-storage-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      identifier,
    )
  )
    throw new Error('Invalid synthetic storage fixture identifier');
  const ids = new Set([
    ...Object.values(defaults).map(record => record.id),
    ragTranscript.transcriptId,
  ]);
  const fixtures = JSON.parse(
    JSON.stringify(defaults, (_key, value: unknown) =>
      typeof value === 'string' && ids.has(value)
        ? identifier + ':' + value
        : value,
    ),
  ) as typeof defaults;
  const hex = identifier
    .slice('test-storage-'.length)
    .toLowerCase()
    .replace(/-/g, '');
  // These are distinct synthetic fixture identifiers, not claimed hashes of real audio.
  fixtures.sampleRecord.contentHash = 'sha256:' + hex.repeat(2);
  fixtures.ragAudioSourceRecord.contentHash =
    'sha256:' + [...hex].reverse().join('').repeat(2);
  return fixtures;
}
