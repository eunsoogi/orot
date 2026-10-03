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

export const AppointmentStatusSchema = z.enum([
  'scheduled',
  'rescheduled',
  'completed',
  'cancelled',
]);

export const AppointmentSchema = RecordMetadataSchema.safeExtend({
  status: AppointmentStatusSchema,
  clinicLabel: NonEmptyTextSchema.optional(),
  note: NonEmptyTextSchema.optional(),
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

export const AppointmentCreateInputSchema = RecordMetadataSchema.safeExtend({
  status: AppointmentStatusSchema.default('scheduled'),
  clinicLabel: NonEmptyTextSchema.optional(),
  note: NonEmptyTextSchema.optional(),
  reason: NonEmptyTextSchema.optional(),
  endsAt: TimestampSchema.optional(),
  encounterId: RecordIdSchema.optional(),
});

export const AppointmentUpdateInputSchema = z
  .strictObject({
    effectiveAt: TimestampSchema.optional(),
    clinicLabel: NonEmptyTextSchema.optional(),
    note: NonEmptyTextSchema.nullable().optional(),
    endsAt: TimestampSchema.nullable().optional(),
  })
  .refine(changes => Object.keys(changes).length > 0, 'Provide at least one appointment change.');

export type AppointmentUpdateInput = z.input<typeof AppointmentUpdateInputSchema>;

export function createAppointment(input: z.input<typeof AppointmentCreateInputSchema>): Appointment {
  return AppointmentSchema.parse(AppointmentCreateInputSchema.parse(input));
}

export function updateAppointment(
  appointment: Appointment,
  changes: AppointmentUpdateInput,
  recordedAt: string,
): Appointment {
  if (appointment.status === 'cancelled') {
    throw new Error('A cancelled appointment cannot be edited.');
  }
  if (appointment.status === 'completed') {
    throw new Error('A completed appointment cannot be edited.');
  }

  const parsedChanges = AppointmentUpdateInputSchema.parse(changes);
  const next = { ...appointment, ...parsedChanges };
  if (parsedChanges.note === null) delete next.note;
  if (parsedChanges.endsAt === null) delete next.endsAt;
  if (
    parsedChanges.effectiveAt !== undefined &&
    parsedChanges.effectiveAt !== appointment.effectiveAt
  ) {
    next.status = 'rescheduled';
  }
  next.recordedAt = recordedAt;
  next.ingestedAt = recordedAt;
  return AppointmentSchema.parse(next);
}

export function cancelAppointment(appointment: Appointment, recordedAt: string): Appointment {
  if (appointment.status === 'cancelled') return appointment;
  if (appointment.status === 'completed') {
    throw new Error('A completed appointment cannot be cancelled.');
  }
  return AppointmentSchema.parse({
    ...appointment,
    status: 'cancelled',
    recordedAt,
    ingestedAt: recordedAt,
  });
}

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
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;
export type VisitQuestion = z.infer<typeof VisitQuestionSchema>;
export type VisitBrief = z.infer<typeof VisitBriefSchema>;
