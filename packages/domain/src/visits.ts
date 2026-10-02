import { z } from 'zod';
import {
  RecordIdSchema,
  RecordMetadataSchema,
  TimestampSchema,
  compareTimestamps,
} from './common';

const NonEmptyTextSchema = z.string().trim().min(1);
const UniqueRecordIdsSchema = z
  .array(RecordIdSchema)
  .refine(ids => new Set(ids).size === ids.length, 'Record IDs must be unique.');

export const AppointmentSchema = RecordMetadataSchema.safeExtend({
  status: z.enum(['scheduled', 'rescheduled', 'completed', 'cancelled']),
  reason: NonEmptyTextSchema.optional(),
  endsAt: TimestampSchema.optional(),
  encounterId: RecordIdSchema.optional(),
}).superRefine((appointment, context) => {
  if (
    appointment.endsAt &&
    compareTimestamps(appointment.endsAt, appointment.effectiveAt) < 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'endsAt must not precede effectiveAt.',
    });
  }
});

export const VisitQuestionSchema = RecordMetadataSchema.safeExtend({
  questionText: NonEmptyTextSchema,
  priority: z.enum(['routine', 'important']),
  evidenceSpanIds: UniqueRecordIdsSchema,
});

export const VisitBriefSchema = RecordMetadataSchema.safeExtend({
  encounterId: RecordIdSchema,
  summary: NonEmptyTextSchema,
  questionIds: UniqueRecordIdsSchema,
  evidenceSpanIds: UniqueRecordIdsSchema.min(1),
  medicationAssertionIds: UniqueRecordIdsSchema,
});

export type Appointment = z.infer<typeof AppointmentSchema>;
export type VisitQuestion = z.infer<typeof VisitQuestionSchema>;
export type VisitBrief = z.infer<typeof VisitBriefSchema>;
