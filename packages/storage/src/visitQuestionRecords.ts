import {
  RecordIdSchema,
  RecapResultSchema,
  TimestampSchema,
  VisitQuestionRecordSchema,
} from '@orot/domain';
import type { VisitQuestionRecord } from '@orot/domain';
import { readStoredRecord, upsertStoredRecord } from './recordPersistence';
import { officialVisitRecordId } from './visitQuestionRecordContracts';
import type { VisitQuestionRecordRepository } from './visitQuestionRecordContracts';
import { requireCurrentRecap, requireVisitQuestion } from './visitQuestionRecordValidation';
import type { SqlDatabase, SqlExecutor } from './sql';

function analysisKey(
  source: NonNullable<VisitQuestionRecord['automaticSource']>,
  questionRevision: string,
): string {
  return JSON.stringify([
    source.recordingSourceId,
    source.binding,
    questionRevision,
    source.sources
      .map((item) => [item.transcriptId, item.revision])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}

/** The repository is the only official-record writer; transaction rollback also undoes history entries. */
export function createVisitQuestionRecordRepository(
  database: SqlDatabase,
  options: { clock?: () => string } = {},
): VisitQuestionRecordRepository {
  const clock = options.clock ?? (() => new Date().toISOString());
  const now = () => TimestampSchema.parse(clock());
  const write = async (sql: SqlExecutor, input: unknown) => {
    const parsed = VisitQuestionRecordSchema.parse(input);
    await upsertStoredRecord(sql, 'visit_question_record', parsed);
    return parsed;
  };
  const decode = (payload: unknown) => VisitQuestionRecordSchema.parse(JSON.parse(String(payload)));
  return {
    async saveManual(input) {
      let saved!: VisitQuestionRecord;
      await database.transaction(async (sql) => {
        const question = await requireVisitQuestion(
          sql,
          input.appointmentId,
          input.questionId,
          input.expectedQuestionRevision,
        );
        const id = officialVisitRecordId(input.appointmentId, question.id);
        const previous = await readStoredRecord(sql, 'visit_question_record', id);
        if (previous) {
          if (previous.questionRevision !== input.expectedQuestionRevision)
            throw new Error('The prepared question changed after confirmation.');
          if (previous.answer !== input.answer)
            throw new Error('The official answer changed; use a versioned edit.');
          saved = previous;
          return;
        }
        const timestamp = now();
        saved = await write(sql, {
          id,
          appointmentId: input.appointmentId,
          questionId: question.id,
          questionText: question.questionText,
          questionRevision: input.expectedQuestionRevision,
          questionSources: [
            {
              healthContextSources: question.healthContextSources,
              generatedArtifactSources: question.generatedArtifactSources,
            },
          ],
          revision: 1,
          sourceMethod: 'manual_confirmed',
          editOrigin: 'manual_confirmation',
          answer: input.answer,
          effectiveAt: timestamp,
          recordedAt: timestamp,
          ingestedAt: timestamp,
          // Preserve the question's original dependencies even if preparation is later edited.
          provenance: {
            origin: 'user_reported',
            sourceRecordIds: [
              ...new Set([...question.provenance.sourceRecordIds, ...question.evidenceSpanIds]),
            ],
          },
          reviewState: { status: 'unreviewed' },
        });
      });
      return saved;
    },
    async saveAutomatic(input, guard) {
      const result = RecapResultSchema.parse(input);
      if (!result.questions.some((question) => question.status === 'evidence_found'))
        throw new Error('No asked question was supported by transcript evidence.');
      const saved: VisitQuestionRecord[] = [];
      await database.transaction(async (sql) => {
        await requireCurrentRecap(sql, result, await guard.loadCurrentInput(sql));
        for (const question of result.questions) {
          if (question.status !== 'evidence_found') continue;
          const prepared = result.preparedQuestions.find(
            (item) => item.id === question.questionId,
          )!;
          const id = officialVisitRecordId(
            result.appointmentId,
            question.questionId,
            result.recordingSourceId,
          );
          const previous = await readStoredRecord(sql, 'visit_question_record', id);
          const storedQuestion = await readStoredRecord(sql, 'visit_question', question.questionId);
          if (!storedQuestion) throw new Error('The prepared question no longer exists.');
          const automaticSource = {
            recordingSourceId: result.recordingSourceId,
            appointmentId: result.appointmentId,
            binding: result.binding,
            providerId: result.providerId,
            modelId: result.modelId,
            promptVersion: result.promptVersion,
            chunkCount: result.chunkCount,
            sources: result.sources,
            result: question,
            questionRevision: prepared.revision,
          };
          const key = analysisKey(automaticSource, prepared.revision);
          if (previous?.automaticSource && previous.analysisKey === key) {
            saved.push(previous);
            continue;
          }
          if (previous?.editOrigin === 'user_edit')
            throw new Error(
              'The official answer changed after AI analysis; preserve the user edit.',
            );
          const timestamp = now();
          saved.push(
            await write(sql, {
              id,
              appointmentId: result.appointmentId,
              questionId: question.questionId,
              questionText: prepared.questionText,
              questionRevision: prepared.revision,
              questionSources: [
                ...(previous?.questionSources ?? []),
                {
                  healthContextSources: storedQuestion.healthContextSources,
                  generatedArtifactSources: storedQuestion.generatedArtifactSources,
                },
              ],
              revision: (previous?.revision ?? 0) + 1,
              sourceMethod: 'ai_generated',
              editOrigin: 'ai_analysis',
              answer: null,
              analysisKey: key,
              automaticSource,
              effectiveAt: previous?.effectiveAt ?? timestamp,
              recordedAt: timestamp,
              ingestedAt: timestamp,
              provenance: {
                origin: 'derived',
                sourceRecordIds: [
                  ...new Set([
                    result.recordingSourceId,
                    ...result.sources.map((source) => source.segmentId),
                    ...storedQuestion.provenance.sourceRecordIds,
                    ...storedQuestion.evidenceSpanIds,
                    // Older immutable history remains dependent on its original sources.
                    ...(previous?.provenance.sourceRecordIds ?? []),
                  ]),
                ],
              },
              reviewState: { status: 'unreviewed' },
            }),
          );
        }
      });
      return saved;
    },
    async edit(input) {
      let saved!: VisitQuestionRecord;
      await database.transaction(async (sql) => {
        const previous = await readStoredRecord(
          sql,
          'visit_question_record',
          RecordIdSchema.parse(input.id),
        );
        if (!previous || previous.revision !== input.expectedRevision)
          throw new Error('The official answer changed before editing.');
        if (previous.answer === input.answer && previous.editOrigin !== 'ai_analysis') {
          saved = previous;
          return;
        }
        const timestamp = now();
        saved = await write(sql, {
          ...previous,
          answer: input.answer,
          revision: previous.revision + 1,
          editOrigin: 'user_edit',
          recordedAt: timestamp,
          ingestedAt: timestamp,
        });
      });
      return saved;
    },
    async listForAppointment(appointmentId) {
      const rows = await database.execute(
        `SELECT payload_json FROM visit_question_records
        WHERE json_extract(payload_json, '$.appointmentId') = ? ORDER BY id`,
        [RecordIdSchema.parse(appointmentId)],
      );
      return rows.rows.map((row) => decode(row.payload_json));
    },
    async history(recordId) {
      const rows = await database.execute(
        'SELECT payload_json FROM visit_question_record_history WHERE record_id = ? ORDER BY revision',
        [RecordIdSchema.parse(recordId)],
      );
      return rows.rows.map((row) => decode(row.payload_json));
    },
  };
}
