import type { RecordKind, RecordRepository } from '@orot/storage';

/** Resolves typed provenance without confusing external samples or revision IDs with source rows. */
export async function readVisitEvidenceSnapshots(
  repository: Pick<RecordRepository, 'get'>,
  recordKind: RecordKind,
  reference: {
    readonly evidenceId: string;
    readonly sourceRecordIds: readonly string[];
    readonly structured: boolean;
  },
) {
  const evidenceRecord = await repository.get(recordKind, reference.evidenceId);
  const fail = () => {
    throw new Error(
      'RAG evidence or its source records changed while visit questions were being prepared.',
    );
  };
  if (!evidenceRecord) return fail();
  const sourceIds = [...new Set(reference.sourceRecordIds)];
  const snapshots = await Promise.all(
    sourceIds.map(async id => {
      const source = await repository.get('source_record', id);
      if (source) return source;
      // The domain appends prior revision IDs when a user corrects a transcript.
      // Only an earlier revision of this same recording/transcript can satisfy it.
      if (
        recordKind === 'transcript_segment' &&
        'transcriptId' in evidenceRecord
      ) {
        const prior = await repository.get('transcript_segment', id);
        if (
          prior &&
          prior.transcriptId === evidenceRecord.transcriptId &&
          prior.recordingSourceId === evidenceRecord.recordingSourceId &&
          prior.revision < evidenceRecord.revision
        )
          return prior;
      }
      // HealthKit sample/concept IDs live outside SQLite. Its persisted imported
      // row retains the source snapshot; deleted local rows still fail above.
      const provenance = evidenceRecord.provenance;
      if (
        reference.structured &&
        provenance.origin === 'imported' &&
        provenance.source?.system === 'healthkit' &&
        provenance.sourceRecordIds.includes(id)
      )
        return { externalSourceId: id, provenance };
      return fail();
    }),
  );
  return { evidenceRecord, sourceIds, snapshots };
}
