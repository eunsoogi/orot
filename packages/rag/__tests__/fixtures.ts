import { createTranscriptCorrection } from '@orot/domain';
// Synthetic fixtures keep medication and measurement examples representative without using personal health data.
import type {
  EvidenceSpan,
  HealthObservation,
  MedicationAssertion,
  SourceRecord,
  TranscriptEvidenceSegment,
} from '@orot/domain';
import type { RecordKind, RecordMap } from '@orot/storage';
import type { PersistedEvidenceReader } from '../src/persistedRecords';

const observedAt = '2026-01-02T08:00:00.000Z';

export const recordingSource: SourceRecord = {
  id: 'rag-fixture-recording',
  effectiveAt: observedAt,
  recordedAt: observedAt,
  ingestedAt: observedAt,
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'audio_recording',
  title: 'Synthetic recording fixture',
  contentHash: 'sha256:' + 'a'.repeat(64),
};

export const noteSource: SourceRecord = {
  ...recordingSource,
  id: 'rag-fixture-note',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  sourceKind: 'user_note',
  title: 'Synthetic medication note',
  contentHash: 'sha256:' + 'b'.repeat(64),
};

export const originalTranscript: TranscriptEvidenceSegment = {
  id: 'rag-fixture-transcript:segment:0:r1',
  transcriptId: 'rag-fixture-transcript:segment:0',
  recordingSourceId: recordingSource.id,
  segmentOrdinal: 0,
  revision: 1,
  text: 'Metformin 250 mg before breakfast.',
  language: 'en-US',
  recordingDurationMs: 5000,
  audioRange: { startMs: 250, endMs: 1800 },
  effectiveAt: observedAt,
  recordedAt: observedAt,
  ingestedAt: observedAt,
  provenance: {
    origin: 'derived',
    sourceRecordIds: [recordingSource.id],
    source: {
      system: 'Synthetic transcription fixture',
      sourceIdentifier: 'fixture-transcriber',
      sourceVersion: '1',
    },
  },
  reviewState: { status: 'unreviewed' },
};

export const correctedTranscript = createTranscriptCorrection(
  originalTranscript,
  'Metformin 500 mg after breakfast.',
  '2026-01-02T08:10:00.000Z',
);

// A later audio interval has its own revision chain and must remain a separate retrieval chunk.
export const nextTranscriptSegment: TranscriptEvidenceSegment = {
  ...originalTranscript,
  id: 'rag-fixture-transcript:segment:1:r1',
  transcriptId: 'rag-fixture-transcript:segment:1',
  segmentOrdinal: 1,
  text: 'Take the next dose with dinner.',
  audioRange: { startMs: 1800, endMs: 2500 },
};

const medicationText = 'Metformin 500 mg once daily after breakfast.';

export const medicationEvidenceSpan: EvidenceSpan = {
  id: 'rag-fixture-medication-span',
  sourceRecordId: noteSource.id,
  text: medicationText,
  locator: { kind: 'text_range', startOffset: 0, endOffset: medicationText.length },
  effectiveAt: observedAt,
  recordedAt: observedAt,
  ingestedAt: observedAt,
  provenance: { origin: 'user_reported', sourceRecordIds: [noteSource.id] },
  reviewState: { status: 'unreviewed' },
};

export const staleTranscriptSpan: EvidenceSpan = {
  id: 'rag-fixture-stale-span',
  sourceRecordId: recordingSource.id,
  text: originalTranscript.text,
  locator: { kind: 'audio_time_range', startMs: 250, endMs: 1800 },
  effectiveAt: observedAt,
  recordedAt: observedAt,
  ingestedAt: observedAt,
  provenance: {
    origin: 'derived',
    sourceRecordIds: [recordingSource.id, originalTranscript.id],
  },
  reviewState: { status: 'unreviewed' },
};

export const currentObservation: HealthObservation = {
  id: 'rag-fixture-observation',
  effectiveAt: observedAt,
  recordedAt: observedAt,
  ingestedAt: observedAt,
  provenance: { origin: 'imported', sourceRecordIds: [noteSource.id] },
  reviewState: { status: 'reviewed', reviewerId: 'fixture-reviewer', reviewedAt: observedAt },
  observationKind: 'measurement',
  concept: 'weight',
  value: {
    kind: 'quantity',
    amount: 70.5,
    unit: 'kg',
    sourceRepresentation: { status: 'available', amount: 155.4, unit: 'lb' },
  },
};

export const currentMedicationAssertion: MedicationAssertion = {
  id: 'rag-fixture-medication-assertion',
  effectiveAt: observedAt,
  recordedAt: observedAt,
  ingestedAt: observedAt,
  provenance: { origin: 'user_reported', sourceRecordIds: [noteSource.id] },
  reviewState: { status: 'unreviewed' },
  assertionKind: 'current_medication_confirmation',
  medicationName: 'Metformin',
  dosageInstruction: '500 mg once daily after breakfast.',
  confirmedByUserId: 'fixture-user',
};

export function createFixtureReader(): PersistedEvidenceReader {
  const records: Partial<{ [K in RecordKind]: RecordMap[K][] }> = {
    source_record: [recordingSource, noteSource],
    health_observation: [currentObservation],
    medication_assertion: [currentMedicationAssertion],
  };

  return {
    async list<K extends RecordKind>(kind: K): Promise<RecordMap[K][]> {
      return (records[kind] ?? []) as RecordMap[K][];
    },
    evidenceSpans: {
      async listForSourceRecord(sourceRecordId) {
        return [medicationEvidenceSpan, staleTranscriptSpan].filter(
          (span) => span.sourceRecordId === sourceRecordId,
        );
      },
    },
    transcripts: {
      async listForRecording(recordingSourceId) {
        return recordingSourceId === recordingSource.id
          ? [originalTranscript, correctedTranscript, nextTranscriptSegment]
          : [];
      },
      async listStaleArtifacts(transcriptId) {
        return transcriptId === correctedTranscript.transcriptId
          ? [
              {
                kind: 'evidence_span',
                id: staleTranscriptSpan.id,
                supersededSegmentId: originalTranscript.id,
                currentSegmentId: correctedTranscript.id,
                invalidatedAt: correctedTranscript.recordedAt,
              },
            ]
          : [];
      },
    },
  };
}
