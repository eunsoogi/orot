import { z } from 'zod';
import { RecordIdSchema, RecordMetadataSchema } from './common';
import { VisitQuestionHealthContextSourceSchema } from './visitQuestionHealthContext';

const NonEmptyTextSchema = z.string().trim().min(1);
const UniqueRecordIdsSchema = z
  .array(RecordIdSchema)
  .refine((ids) => new Set(ids).size === ids.length, 'Record IDs must be unique.');

export const VisitQuestionSchema = RecordMetadataSchema.safeExtend({
  questionText: NonEmptyTextSchema,
  priority: z.enum(['routine', 'important']),
  evidenceSpanIds: UniqueRecordIdsSchema,
  // Older lists have only quote spans. New computed citations retain their fixed period and revision.
  healthContextSources: z.array(VisitQuestionHealthContextSourceSchema).min(1).max(3).optional(),
  // Optional fields keep older saved questions readable; new reviewed lists use the required schema below.
  appointmentId: RecordIdSchema.optional(),
  rationale: NonEmptyTextSchema.optional(),
  position: z.number().int().min(1).max(5).optional(),
});

/** Requires an appointment association and stable display order for a newly saved reviewed list. */
export const VisitQuestionCreateSchema = VisitQuestionSchema.safeExtend({
  appointmentId: RecordIdSchema,
  rationale: NonEmptyTextSchema,
  position: z.number().int().min(1).max(5),
});

export type VisitQuestion = z.infer<typeof VisitQuestionSchema>;
export type VisitQuestionCreate = z.infer<typeof VisitQuestionCreateSchema>;
