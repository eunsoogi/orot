import { z } from 'zod';
import { RecordIdSchema, RecordMetadataSchema } from './common';
import { RecapQuestionResultSchema, RecapResultSchema } from './recap';

const AutomaticVisitQuestionSourceSchema = RecapResultSchema.omit({
  preparedQuestions: true,
  questions: true,
}).extend({ result: RecapQuestionResultSchema, questionRevision: RecordIdSchema });

/** Official records are distinct from preparation candidates; AI origin survives later user edits. */
export const VisitQuestionRecordSchema = RecordMetadataSchema.safeExtend({
  appointmentId: RecordIdSchema,
  questionId: RecordIdSchema,
  questionText: z.string().trim().min(1),
  revision: z.number().int().positive(),
  sourceMethod: z.enum(['manual_confirmed', 'ai_generated']),
  editOrigin: z.enum(['manual_confirmation', 'ai_analysis', 'user_edit']),
  // A missing clinician answer stays null; corrections never replace the original AI quotations.
  answer: z.string().trim().min(1).max(16000).nullable(),
  automaticSource: AutomaticVisitQuestionSourceSchema.optional(),
  analysisKey: z.string().min(1).optional(),
}).superRefine((record, context) => {
  const automatic = record.sourceMethod === 'ai_generated';
  if (
    automatic !== Boolean(record.automaticSource) ||
    automatic !== Boolean(record.analysisKey) ||
    (automatic &&
      (record.provenance.origin !== 'derived' || record.editOrigin === 'manual_confirmation')) ||
    (!automatic &&
      (record.provenance.origin !== 'user_reported' || record.editOrigin === 'ai_analysis')) ||
    record.automaticSource?.appointmentId !== (automatic ? record.appointmentId : undefined) ||
    (automatic && record.automaticSource?.result.questionId !== record.questionId) ||
    (automatic && record.reviewState.status === 'reviewed')
  )
    context.addIssue({
      code: 'custom',
      message: 'Official record origin and AI source must agree.',
    });
});

export type VisitQuestionRecord = z.infer<typeof VisitQuestionRecordSchema>;
