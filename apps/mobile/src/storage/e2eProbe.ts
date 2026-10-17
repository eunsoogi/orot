import type { RecordKind } from '@orot/storage';
import { buildPersistedEvidenceChunks } from '@orot/rag';
import { createStorageProbeFixtures } from './storageProbeFixtures';
import {
  getCipherVersion,
  hasDatabaseKey,
  openLocalStorage,
  prepareLegacyStorageForE2e,
  verifyWrongKeyRejected,
} from './secureDatabase';

export type StorageProbeMode = 'fresh' | 'restart' | 'legacy';

async function seedRagProbe(
  repository: Awaited<ReturnType<typeof openLocalStorage>>,
  fixtures: ReturnType<typeof createStorageProbeFixtures>,
) {
  const {
    ragMedicationSpan,
    ragAudioSourceRecord,
    ragTranscript,
    staleTranscriptSpan,
    ragObservation,
  } = fixtures;
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
  fixtures: ReturnType<typeof createStorageProbeFixtures>,
) {
  const {
    ragMedicationSpan,
    ragTranscript,
    staleTranscriptSpan,
    ragObservation,
  } = fixtures;
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
    medication?.text !== ragMedicationSpan.text ||
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

export async function runStorageProbe(
  mode: StorageProbeMode,
  fixtureIdentifier?: string,
): Promise<void> {
  const fixtures = createStorageProbeFixtures(fixtureIdentifier);
  const { sampleRecord, sampleEvidenceSpan } = fixtures;
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
    await seedRagProbe(repository, fixtures);
    await verifyRagProbe(repository, fixtures);
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
    await verifyRagProbe(repository, fixtures);
  }
}
