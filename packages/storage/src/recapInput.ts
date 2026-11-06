import { RecapInputSchema, TranscriptEvidenceSegmentSchema } from '@orot/domain';
import type { SqlExecutor } from './sql';
import { readRecapBinding } from './recapBinding';
import { readVisitQuestionRevision } from './visitQuestionRecordValidation';

/** Read the binding and every source through the caller's transaction when preparing or saving. */
export async function loadCurrentRecapInput(sql: SqlExecutor, recordingId: string) {
  const linked = await readRecapBinding(sql, recordingId);
  if (!linked) return null;
  const rows = await sql.execute(
    "SELECT payload_json FROM visit_questions WHERE json_extract(payload_json, '$.appointmentId') = ? ORDER BY id",
    [linked.appointmentId],
  );
  const questions = [];
  for (const row of rows.rows) {
    const question = JSON.parse(String(row.payload_json));
    const revision = await readVisitQuestionRevision(sql, question.id);
    if (!revision) throw new Error('The prepared question no longer exists.');
    questions.push({
      id: question.id,
      appointmentId: linked.appointmentId,
      questionText: question.questionText,
      revision,
    });
  }
  const transcripts = await sql.execute(
    "SELECT payload_json FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = ?",
    [recordingId],
  );
  const latest = new Map<string, ReturnType<typeof TranscriptEvidenceSegmentSchema.parse>>();
  for (const row of transcripts.rows) {
    const segment = TranscriptEvidenceSegmentSchema.parse(JSON.parse(String(row.payload_json)));
    if ((latest.get(segment.transcriptId)?.revision ?? 0) < segment.revision)
      latest.set(segment.transcriptId, segment);
  }
  return RecapInputSchema.parse({
    recordingSourceId: recordingId,
    appointmentId: linked.appointmentId,
    binding: linked.binding,
    questions,
    segments: [...latest.values()].sort((a, b) => a.segmentOrdinal - b.segmentOrdinal),
  });
}
