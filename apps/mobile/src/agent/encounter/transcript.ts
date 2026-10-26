import { TranscriptEvidenceSegmentSchema } from '@orot/domain';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import type { EncounterTranscript } from '@orot/agent-runtime';
import type { RecordWriter, SqlExecutor } from '@orot/storage';

/** Corrections are append-only: choose the latest revision per stable segment, never concatenate old text. */
export function currentEncounterTranscript(
  sourceId: string,
  rows: TranscriptEvidenceSegment[],
): EncounterTranscript {
  const latest = new Map<string, TranscriptEvidenceSegment>();
  for (const row of rows) {
    const segment = TranscriptEvidenceSegmentSchema.parse(row);
    if (segment.recordingSourceId !== sourceId)
      throw new Error('Foreign transcript segment.');
    if ((latest.get(segment.transcriptId)?.revision ?? 0) < segment.revision)
      latest.set(segment.transcriptId, segment);
  }
  if (!latest.size || latest.size > 8)
    throw new Error('Select a bounded nonempty transcript.');
  return {
    sourceId,
    segments: [...latest.values()]
      .sort((a, b) => a.segmentOrdinal - b.segmentOrdinal)
      .map(({ id, transcriptId, revision, text, effectiveAt, audioRange }) => ({
        id,
        transcriptId,
        revision,
        text,
        effectiveAt,
        audioRange,
      })),
  };
}

/** The final source/revision read shares the canonical write transaction, including deletion races. */
export async function readEncounterTranscript(
  writer: RecordWriter,
  sql: SqlExecutor,
  sourceId: string,
) {
  const source = await writer.get('source_record', sourceId);
  if (!source || source.sourceKind !== 'audio_recording')
    throw new Error('Recording source unavailable.');
  const result = await sql.execute(
    "SELECT payload_json FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = ?",
    [sourceId],
  );
  return currentEncounterTranscript(
    sourceId,
    result.rows.map(row =>
      TranscriptEvidenceSegmentSchema.parse(
        JSON.parse(String(row.payload_json)),
      ),
    ),
  );
}
