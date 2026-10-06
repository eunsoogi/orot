import type { Appointment, Encounter } from '@orot/domain';
import { chunkEvidenceSpan, chunkStructuredRecord, chunkTranscriptSegment } from '../src/chunking';
import { buildPersistedEvidenceChunks } from '../src/persistedRecords';
import {
  correctedTranscript,
  createFixtureReader,
  currentMedicationAssertion,
  currentObservation,
  medicationEvidenceSpan,
  nextTranscriptSegment,
  noteSource,
  originalTranscript,
  recordingSource,
  staleTranscriptSpan,
} from './fixtures';

describe('evidence-aware chunks', () => {
  it('keeps a transcript revision locator and review provenance while reusing its logical ID', () => {
    const original = chunkTranscriptSegment(originalTranscript);
    const corrected = chunkTranscriptSegment(correctedTranscript);

    expect(corrected.id).toBe(original.id);
    expect(corrected).toMatchObject({
      text: 'Metformin 500 mg after breakfast.',
      metadata: {
        sourceId: recordingSource.id,
        sourceRecordIds: [recordingSource.id, originalTranscript.id],
        evidenceId: correctedTranscript.id,
        evidenceLocator: { kind: 'audio_time_range', startMs: 250, endMs: 1800 },
        effectiveTime: originalTranscript.effectiveAt,
        recordType: 'transcript_segment',
        reviewState: {
          status: 'needs_review',
          reason: 'Transcript text was corrected by the user.',
        },
        transcriptRevision: {
          transcriptId: correctedTranscript.transcriptId,
          segmentOrdinal: 0,
          revision: 2,
          supersedesId: originalTranscript.id,
        },
      },
    });
  });

  it('retains an exact text locator and keeps medication, amount, and local text together', () => {
    const chunk = chunkEvidenceSpan(medicationEvidenceSpan);

    expect(chunk.text).toBe(medicationEvidenceSpan.text);
    expect(chunk.metadata).toMatchObject({
      sourceId: medicationEvidenceSpan.sourceRecordId,
      evidenceId: medicationEvidenceSpan.id,
      evidenceLocator: medicationEvidenceSpan.locator,
      effectiveTime: medicationEvidenceSpan.effectiveAt,
      recordType: 'evidence_span',
      reviewState: { status: 'unreviewed' },
    });
    expect(() => chunkEvidenceSpan({ ...staleTranscriptSpan, locator: undefined })).toThrow(
      'source locator',
    );
  });

  it('keeps a structured quantity with its unit and source representation without calculating a replacement', () => {
    const chunk = chunkStructuredRecord('health_observation', currentObservation);

    expect(chunk.metadata).toMatchObject({
      sourceId: currentObservation.provenance.sourceRecordIds[0],
      sourceRecordIds: currentObservation.provenance.sourceRecordIds,
      evidenceId: currentObservation.id,
      evidenceLocator: { kind: 'structured_record', recordId: currentObservation.id },
      effectiveTime: currentObservation.effectiveAt,
      recordType: 'health_observation',
      reviewState: { status: 'reviewed', reviewerId: 'fixture-reviewer' },
    });
    expect(chunk.text).toContain('"amount":70.5');
    expect(chunk.text).toContain('"unit":"kg"');
    expect(chunk.text).toContain(
      '"sourceRepresentation":{"amount":155.4,"status":"available","unit":"lb"}',
    );
  });

  it('keeps a structured medication name and dosage instruction in one source record chunk', () => {
    const chunk = chunkStructuredRecord('medication_assertion', currentMedicationAssertion);

    expect(chunk.text).toContain('"medicationName":"Metformin"');
    expect(chunk.text).toContain('"dosageInstruction":"500 mg once daily after breakfast."');
    expect(chunk.metadata).toMatchObject({
      sourceId: noteSource.id,
      evidenceId: currentMedicationAssertion.id,
      recordType: 'medication_assertion',
      reviewState: { status: 'unreviewed' },
    });
  });

  it('records explicit encounter relationships without inferring them from provenance', () => {
    const metadata = {
      effectiveAt: '2026-01-02T08:00:00.000Z',
      recordedAt: '2026-01-02T08:00:00.000Z',
      ingestedAt: '2026-01-02T08:00:00.000Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    const appointment: Appointment = {
      ...metadata,
      id: 'appointment-1',
      status: 'scheduled',
      encounterId: 'encounter-1',
    };
    const encounter: Encounter = {
      ...metadata,
      id: 'encounter-1',
      encounterKind: 'outpatient',
    };

    expect(chunkStructuredRecord('appointment', appointment).metadata.encounterId).toBe(
      'encounter-1',
    );
    expect(chunkStructuredRecord('encounter', encounter).metadata.encounterId).toBe('encounter-1');
    expect(
      chunkStructuredRecord('health_observation', currentObservation).metadata,
    ).not.toHaveProperty('encounterId');
  });

  it('reads only the latest transcript revision and omits artifacts marked stale by storage', async () => {
    const reader = createFixtureReader();
    const first = await buildPersistedEvidenceChunks(reader);
    const second = await buildPersistedEvidenceChunks(reader);
    const transcriptChunks = first.filter(
      (chunk) => chunk.metadata.recordType === 'transcript_segment',
    );

    expect(transcriptChunks).toHaveLength(2);
    expect(new Set(transcriptChunks.map((chunk) => chunk.id)).size).toBe(2);
    expect(
      transcriptChunks.find((chunk) => chunk.metadata.transcriptRevision?.segmentOrdinal === 0),
    ).toMatchObject({
      id: chunkTranscriptSegment(correctedTranscript).id,
      text: correctedTranscript.text,
      metadata: {
        evidenceId: correctedTranscript.id,
        evidenceLocator: { kind: 'audio_time_range', startMs: 250, endMs: 1800 },
        transcriptRevision: { revision: 2 },
      },
    });
    expect(
      transcriptChunks.find((chunk) => chunk.metadata.transcriptRevision?.segmentOrdinal === 1),
    ).toMatchObject({
      id: chunkTranscriptSegment(nextTranscriptSegment).id,
      text: nextTranscriptSegment.text,
      metadata: {
        evidenceId: nextTranscriptSegment.id,
        evidenceLocator: { kind: 'audio_time_range', startMs: 1800, endMs: 2500 },
        transcriptRevision: { transcriptId: nextTranscriptSegment.transcriptId, revision: 1 },
      },
    });
    expect(first.some((chunk) => chunk.metadata.evidenceId === originalTranscript.id)).toBe(false);
    expect(first.some((chunk) => chunk.metadata.evidenceId === staleTranscriptSpan.id)).toBe(false);
    expect(first.map((chunk) => chunk.id)).toEqual(second.map((chunk) => chunk.id));
  });
});
