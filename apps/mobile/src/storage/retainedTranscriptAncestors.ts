import type { EvidenceReference } from '@orot/agent-runtime';
import { TranscriptEvidenceSegmentSchema } from '@orot/domain';
import {
  retainedRecordKey,
  type readRetainedRecordRows,
} from './retainedRecordRows';

type Batch = Awaited<ReturnType<typeof readRetainedRecordRows>>;
const noAncestors = () => false;

function parseTranscript(serialized: string) {
  const parsed = TranscriptEvidenceSegmentSchema.safeParse(
    JSON.parse(serialized),
  );
  return parsed.success ? parsed.data : undefined;
}

/** A superseded row is tolerated only as immutable ancestry of this exact
 * current, cited excerpt. Neither equivalent text nor an unrelated newer row
 * can make a superseded citation current. All retained rows still need their
 * committed original digests and retain independent stale-marker checks. */
export function currentRetainedTranscriptAncestors(
  batch: Batch,
  reference?: EvidenceReference,
): (id: string, serialized: string) => boolean {
  const locator = reference?.locator;
  if (
    reference?.sourceKind !== 'personal_record' ||
    !locator ||
    typeof locator !== 'object' ||
    Array.isArray(locator) ||
    !('kind' in locator) ||
    locator.kind !== 'audio_time_range' ||
    !batch.records.some(
      record =>
        record.kind === 'source_record' &&
        record.id === reference.sourceId &&
        record.revision === reference.sourceRevision,
    ) ||
    !batch.records.some(
      record =>
        record.kind === 'transcript_segment' &&
        record.id === reference.evidenceId &&
        record.revision === reference.evidenceRevision,
    )
  )
    return noAncestors;
  const row = batch.rows.get(
    retainedRecordKey({
      kind: 'transcript_segment',
      id: reference.evidenceId,
    }),
  );
  if (!row || row.stale || row.superseded) return noAncestors;
  const head = parseTranscript(row.serialized);
  if (
    !head ||
    head.id !== reference.evidenceId ||
    head.recordingSourceId !== reference.sourceId ||
    !('startMs' in locator) ||
    !('endMs' in locator) ||
    locator.startMs !== head.audioRange.startMs ||
    locator.endMs !== head.audioRange.endMs
  )
    return noAncestors;

  const antecedents = new Set(head.provenance.sourceRecordIds);
  return (id, serialized) => {
    if (!antecedents.has(id)) return false;
    const older = parseTranscript(serialized);
    return (
      older?.id === id &&
      older.recordingSourceId === head.recordingSourceId &&
      older.transcriptId === head.transcriptId &&
      older.segmentOrdinal === head.segmentOrdinal &&
      older.revision < head.revision
    );
  };
}
