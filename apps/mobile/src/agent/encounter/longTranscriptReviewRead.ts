import { encounterCanonical } from '@orot/agent-runtime';
import type {
  EncounterPending,
  EncounterTranscript,
} from '@orot/agent-runtime';
import { TranscriptEvidenceSegmentSchema } from '@orot/domain';
import { requireLiveCheckpointSource } from '@orot/storage';
import type { RecordWriter, SqlExecutor } from '@orot/storage';
import { currentEncounterTranscriptPageSql } from './currentTranscriptPageSql';

/** Proof against the full revision sequence. Only excerpts to be reviewed
 * retain hydrated parent text, not the complete recording transcript. */
export async function readLongTranscriptReview(
  writer: RecordWriter,
  sql: SqlExecutor,
  pending: EncounterPending,
  active: () => void,
): Promise<EncounterTranscript> {
  const { sourceId } = pending;
  await requireLiveCheckpointSource(sql, sourceId);
  if (
    (await writer.get('source_record', sourceId))?.sourceKind !==
    'audio_recording'
  )
    throw new Error('Recording source unavailable.');
  const required = new Set(
    pending.candidates.flatMap(row => row.evidence.map(span => span.segmentId)),
  );
  const transcript: EncounterTranscript = { sourceId, segments: [] };
  let position = 0;
  let afterOrdinal = -1;
  let afterId = '';
  for (;;) {
    active();
    const { rows } = await sql.execute(currentEncounterTranscriptPageSql, [
      sourceId,
      afterOrdinal,
      afterId,
      16,
    ]);
    for (const row of rows) {
      const segment = TranscriptEvidenceSegmentSchema.parse(
        JSON.parse(String(row.payload_json)),
      );
      const { id, transcriptId, revision, text, audioRange, effectiveAt } =
        segment;
      const reference = { id, transcriptId, revision, audioRange, effectiveAt };
      if (
        segment.recordingSourceId !== sourceId ||
        encounterCanonical(reference) !==
          encounterCanonical(pending.segments[position++])
      )
        throw new Error('Transcript changed before review.');
      if (required.delete(id)) transcript.segments.push({ ...reference, text });
      afterOrdinal = segment.segmentOrdinal;
      afterId = id;
    }
    if (rows.length < 16) break;
  }
  active();
  if (required.size || position !== pending.segments.length || position <= 8)
    throw new Error('Transcript changed before review.');
  return transcript;
}
