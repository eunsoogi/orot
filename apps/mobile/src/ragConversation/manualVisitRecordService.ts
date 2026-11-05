import {
  createVisitQuestionRecordRepository,
  readVisitQuestionRevision,
} from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { VisitQuestionSchema } from '@orot/domain';
import type { VisitQuestion, VisitQuestionRecord } from '@orot/domain';

export interface ManualVisitQuestion {
  readonly question: VisitQuestion;
  readonly revision: string;
  readonly records: readonly VisitQuestionRecord[];
}

/** Uses the same encrypted database and transaction-bound revision as official record writes. */
export function createManualVisitRecords(database: SqlDatabase) {
  const official = createVisitQuestionRecordRepository(database);
  return {
    async load(appointmentId: string): Promise<ManualVisitQuestion[]> {
      let questions: Array<{ question: VisitQuestion; revision: string }> = [];
      await database.transaction(async sql => {
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
      return questions.map(item => ({
        ...item,
        records: records.filter(
          record => record.questionId === item.question.id,
        ),
      }));
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
