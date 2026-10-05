import type { RecordMap, RecordKind } from '@orot/storage';
import { buildPersistedEvidenceChunks } from '@orot/rag';
import {
  getCipherVersion,
  hasDatabaseKey,
  openLocalStorage,
  prepareLegacyStorageForE2e,
  verifyWrongKeyRejected,
} from './secureDatabase';

export type StorageProbeMode = 'fresh' | 'restart' | 'legacy';

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

async function seedRagProbe(
  repository: Awaited<ReturnType<typeof openLocalStorage>>,
) {
  await repository.sourceRecords.create(ragAudioSourceRecord);
  await repository.evidenceSpans.create(ragMedicationSpan);
  await repository.transcripts.append([ragTranscript]);
  await repository.evidenceSpans.create(staleTranscriptSpan);
  await repository.put('health_observation', ragObservation);
  return repository.transcripts.correct(
    ragTranscript.id,
    'Metformin 500 mg after breakfast.',
    '2026-01-02T08:10:00.000Z',
  );
}

async function verifyRagProbe(
  repository: Awaited<ReturnType<typeof openLocalStorage>>,
) {
  const chunks = await buildPersistedEvidenceChunks(repository);
  const currentTranscript = chunks.find(
    chunk =>
      chunk.metadata.transcriptRevision?.transcriptId ===
      ragTranscript.transcriptId,
  );
  const medication = chunks.find(
    chunk => chunk.metadata.evidenceId === ragMedicationSpan.id,
  );
  const observation = chunks.find(
    chunk => chunk.metadata.evidenceId === ragObservation.id,
  );
  const staleArtifacts = await repository.transcripts.listStaleArtifacts(
    ragTranscript.transcriptId,
  );

  if (
    !currentTranscript ||
    currentTranscript.text !== 'Metformin 500 mg after breakfast.' ||
    currentTranscript.metadata.transcriptRevision?.revision !== 2 ||
    currentTranscript.metadata.transcriptRevision?.supersedesId !==
      ragTranscript.id ||
    currentTranscript.metadata.reviewState.status !== 'needs_review' ||
    currentTranscript.metadata.effectiveTime !== ragTranscript.effectiveAt ||
    currentTranscript.metadata.evidenceLocator.kind !== 'audio_time_range' ||
    medication?.text !== ragMedicationText ||
    observation?.metadata.recordType !== 'health_observation' ||
    !observation.text.includes('"amount":70.5') ||
    !observation.text.includes('"unit":"kg"') ||
    chunks.some(chunk => chunk.metadata.evidenceId === ragTranscript.id) ||
    chunks.some(
      chunk => chunk.metadata.evidenceId === staleTranscriptSpan.id,
    ) ||
    !staleArtifacts.some(
      artifact =>
        artifact.kind === 'evidence_span' &&
        artifact.id === staleTranscriptSpan.id,
    )
  ) {
    throw new Error(
      'Persisted local records did not produce the expected RAG evidence chunks.',
    );
  }
}

export async function runStorageProbe(mode: StorageProbeMode): Promise<void> {
  if (mode === 'legacy') await prepareLegacyStorageForE2e(sampleRecord);
  const repository = await openLocalStorage();
  const cipherVersion = await getCipherVersion();
  if (!cipherVersion || !(await hasDatabaseKey())) {
    throw new Error('Encrypted storage is unavailable.');
  }
  if (!(await verifyWrongKeyRejected())) {
    throw new Error('The database accepted an incorrect encryption key.');
  }

  const kind: RecordKind = 'source_record';
  if (mode === 'fresh') {
    const stored = await repository.sourceRecords.create(sampleRecord);
    const duplicate = await repository.sourceRecords.create({
      ...sampleRecord,
      id: 'storage-e2e-duplicate',
      title: 'Duplicate content must keep the first source record.',
    });
    if (duplicate.id !== stored.id) {
      throw new Error(
        'Duplicate source content was not resolved deterministically.',
      );
    }
    await repository.evidenceSpans.create(sampleEvidenceSpan);
    await seedRagProbe(repository);
    await verifyRagProbe(repository);
    return;
  }
  const stored =
    mode === 'legacy'
      ? await repository.get(kind, sampleRecord.id)
      : await repository.sourceRecords.get(sampleRecord.id);
  if (!stored || stored.title !== sampleRecord.title) {
    throw new Error('The synthetic storage record was not preserved.');
  }
  if (mode === 'restart') {
    // The RAG probe adds sibling spans, so verify this storage fixture by its stable ID.
    const storedEvidenceSpan = await repository.evidenceSpans.get(
      sampleEvidenceSpan.id,
    );
    if (
      !storedEvidenceSpan ||
      storedEvidenceSpan.sourceRecordId !== sampleRecord.id ||
      storedEvidenceSpan.locator?.kind !== 'text_range' ||
      storedEvidenceSpan.locator.endOffset !== 35
    ) {
      throw new Error('The synthetic evidence span was not preserved.');
    }
    await verifyRagProbe(repository);
  }
}
