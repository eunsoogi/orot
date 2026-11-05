import {
  isRecapResultCurrent,
  RecapInputSchema,
  RecordIdSchema,
  TranscriptEvidenceSegmentSchema,
} from '@orot/domain';
import type { RecapInput, RecapResult } from '@orot/domain';
import { readStoredRecord } from './recordPersistence';
import type { SqlExecutor } from './sql';

/** Returns an opaque `v1:<counter>` revision; call with the write transaction when validating Recap.
 * Migration initializes existing questions to one; inserts and updates advance the durable counter.
 * A deleted ID retains its counter, preventing a later reinsert from reviving an old snapshot.
 */
export async function readVisitQuestionRevision(
  sql: SqlExecutor,
  questionId: string,
): Promise<string | null> {
  const result = await sql.execute(
    'SELECT revision FROM visit_question_revisions JOIN visit_questions ON visit_questions.id = question_id WHERE question_id = ?',
    [RecordIdSchema.parse(questionId)],
  );
  const revision = result.rows[0]?.revision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0
    ? `v1:${revision}`
    : null;
}

export async function requireVisitQuestion(
  sql: SqlExecutor,
  appointmentId: string,
  questionId: string,
  expectedRevision: string,
) {
  const current = await readStoredRecord(sql, 'visit_question', questionId);
  if (
    !(await readStoredRecord(sql, 'appointment', appointmentId)) ||
    !current ||
    current.appointmentId !== appointmentId ||
    (await readVisitQuestionRevision(sql, questionId)) !== expectedRevision
  ) {
    throw new Error('The visit or prepared question changed before saving.');
  }
  return current;
}

/** Re-read live rows after the trusted binding loader; all validation and writes share one transaction. */
export async function requireCurrentRecap(
  sql: SqlExecutor,
  result: RecapResult,
  input: RecapInput,
): Promise<void> {
  const current = RecapInputSchema.parse(input);
  if (!isRecapResultCurrent(result, current)) throw new Error('The Recap source snapshot changed.');
  const recording = await readStoredRecord(sql, 'source_record', result.recordingSourceId);
  if (!recording || recording.sourceKind !== 'audio_recording')
    throw new Error('The recording source was deleted.');
  for (const prepared of current.questions) {
    const stored = await readStoredRecord(sql, 'visit_question', prepared.id);
    if (
      !stored ||
      stored.appointmentId !== result.appointmentId ||
      stored.questionText !== prepared.questionText
    ) {
      throw new Error('The prepared question changed before saving.');
    }
    await requireVisitQuestion(sql, result.appointmentId, prepared.id, prepared.revision);
  }
  const rows = await sql.execute(
    `SELECT payload_json FROM transcript_segments
    WHERE json_extract(payload_json, '$.recordingSourceId') = ?`,
    [result.recordingSourceId],
  );
  const latest = new Map<string, RecapInput['segments'][number]>();
  for (const row of rows.rows) {
    const segment = TranscriptEvidenceSegmentSchema.parse(JSON.parse(String(row.payload_json)));
    if ((latest.get(segment.transcriptId)?.revision ?? 0) < segment.revision)
      latest.set(segment.transcriptId, segment);
  }
  if (
    latest.size !== current.segments.length ||
    current.segments.some(
      (segment) => JSON.stringify(latest.get(segment.transcriptId)) !== JSON.stringify(segment),
    )
  )
    throw new Error('The transcript revision changed.');
  for (const question of result.questions) {
    for (const answer of question.answers) {
      if (answer.quotation !== answer.evidence.map((evidence) => evidence.quote).join('\n')) {
        throw new Error('The answer quotation does not match its transcript evidence.');
      }
    }
  }
}
