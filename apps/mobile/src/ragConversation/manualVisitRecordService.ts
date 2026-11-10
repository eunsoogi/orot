import {
  createVisitQuestionRecordRepository,
  readVisitQuestionRevision,
  readCurrentRecapResult,
} from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { VisitQuestionSchema } from '@orot/domain';
import type { VisitQuestion, VisitQuestionRecord } from '@orot/domain';

export interface ManualVisitQuestion {
  readonly question: VisitQuestion;
  readonly revision: string;
  readonly records: readonly VisitQuestionRecord[];
  readonly staleAutomaticIds?: readonly string[];
}

/** Uses the same encrypted database and transaction-bound revision as official record writes. */
export function createManualVisitRecords(database: SqlDatabase) {
  const official = createVisitQuestionRecordRepository(database);
  return {
    async load(appointmentId: string): Promise<ManualVisitQuestion[]> {
      let questions: Array<{ question: VisitQuestion; revision: string }> = [];
      await database.transaction(async sql => {
        const appointment = await sql.execute(
          'SELECT id FROM appointments WHERE id = ?',
          [appointmentId],
        );
        if (!appointment.rows.length)
          throw new Error('The selected appointment is unavailable.');
        const rows = await sql.execute(
          "SELECT payload_json FROM visit_questions WHERE json_extract(payload_json, '$.appointmentId') = ? ORDER BY json_extract(payload_json, '$.position'), id",
          [appointmentId],
        );
        questions = await Promise.all(
          rows.rows.map(async row => {
            const question = VisitQuestionSchema.parse(
              JSON.parse(String(row.payload_json)),
            );
            const revision = await readVisitQuestionRevision(sql, question.id);
            if (!revision) throw new Error('Question revision is unavailable.');
            return { question, revision };
          }),
        );
      });
      const records = await official.listForAppointment(appointmentId);
      return Promise.all(
        questions.map(async item => {
          const selected = records.filter(
            record => record.questionId === item.question.id,
          );
          const staleAutomaticIds: string[] = [];
          const visible: VisitQuestionRecord[] = [];
          for (const record of selected) {
            if (
              record.sourceMethod === 'ai_generated' &&
              record.automaticSource
            ) {
              const source = record.automaticSource;
              const current = await readCurrentRecapResult(
                database,
                source.recordingSourceId,
              ).catch(() => null);
              // Match the exact snapshot, not merely the recording: a newer analysis does not refresh an older record.
              const fresh =
                current &&
                current.appointmentId === appointmentId &&
                JSON.stringify(current.binding) ===
                  JSON.stringify(source.binding) &&
                JSON.stringify(current.sources) ===
                  JSON.stringify(source.sources) &&
                current.preparedQuestions.some(
                  q =>
                    q.id === record.questionId &&
                    q.revision === record.questionRevision,
                );
              if (!fresh) {
                if (record.editOrigin === 'user_edit') {
                  staleAutomaticIds.push(record.id);
                  visible.push(record);
                }
                continue;
              }
            }
            visible.push(record);
          }
          return { ...item, records: visible, staleAutomaticIds };
        }),
      );
    },
    saveManual: official.saveManual,
    edit: official.edit,
  };
}

export async function openManualVisitRecords() {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  return createManualVisitRecords(await openLocalAgentMemoryDatabase());
}

export type ManualVisitRecords = ReturnType<typeof createManualVisitRecords>;
