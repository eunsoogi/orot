import { z } from 'zod';
import { RecordIdSchema, RecordMetadataSchema, TimestampSchema, compareTimestamps } from './common';

const NonEmptyTextSchema = z.string().trim().min(1);
const UniqueRecordIdsSchema = z
  .array(RecordIdSchema)
  .refine((ids) => new Set(ids).size === ids.length, 'Record IDs must be unique.');

export const AppointmentStatusSchema = z.enum([
  'scheduled',
  'rescheduled',
  'completed',
  'cancelled',
]);

const NonZeroIntegerSchema = (minimum: number, maximum: number) =>
  z
    .number()
    .int()
    .min(minimum)
    .max(maximum)
    .refine((value) => value !== 0);

const FloatingCalendarDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/)
  .refine((value) => {
    const date = new Date(`${value}Z`);
    return Number.isFinite(date.getTime()) && date.toISOString() === `${value}Z`;
  }, 'Floating Calendar date and time components must be a valid Gregorian date.');

const CalendarRecurrenceEndSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('date'),
      date: TimestampSchema.nullable(),
      floatingDateTime: FloatingCalendarDateTimeSchema.nullable().optional(),
    })
    .refine(
      (value) =>
        value.date === null
          ? typeof value.floatingDateTime === 'string'
          : value.floatingDateTime == null,
      'A recurrence end must use either an absolute date or floating civil time.',
    ),
  z.strictObject({ kind: z.literal('count'), occurrenceCount: z.number().int().min(1) }),
]);

const CalendarRecurrenceRuleSchema = z.strictObject({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1),
  firstDayOfTheWeek: z.number().int().min(0).max(7),
  daysOfTheWeek: z
    .array(
      z.strictObject({
        dayOfTheWeek: z.number().int().min(1).max(7),
        weekNumber: z.number().int().min(-53).max(53),
      }),
    )
    .nullable(),
  daysOfTheMonth: z.array(NonZeroIntegerSchema(-31, 31)).nullable(),
  monthsOfTheYear: z.array(z.number().int().min(1).max(12)).nullable(),
  weeksOfTheYear: z.array(NonZeroIntegerSchema(-53, 53)).nullable(),
  daysOfTheYear: z.array(NonZeroIntegerSchema(-366, 366)).nullable(),
  setPositions: z.array(NonZeroIntegerSchema(-366, 366)).nullable(),
  end: CalendarRecurrenceEndSchema.nullable(),
});

/** Calendar metadata captured only after the user confirms one EventKit event. */
export const CalendarAppointmentSnapshotSchema = z.strictObject({
  title: z.string().max(4096),
  timeZoneIdentifier: z.string().trim().min(1).nullable(),
  isAllDay: z.boolean(),
  floatingStartAt: FloatingCalendarDateTimeSchema.nullable().optional(),
  floatingEndAt: FloatingCalendarDateTimeSchema.nullable().optional(),
  occurrenceDate: TimestampSchema.nullable(),
  floatingOccurrenceAt: FloatingCalendarDateTimeSchema.nullable().optional(),
  isDetached: z.boolean(),
  recurrenceRules: z.array(CalendarRecurrenceRuleSchema).max(1),
});

export const AppointmentSchema = RecordMetadataSchema.safeExtend({
  status: AppointmentStatusSchema,
  clinicLabel: NonEmptyTextSchema.optional(),
  note: NonEmptyTextSchema.optional(),
  reason: NonEmptyTextSchema.optional(),
  endsAt: TimestampSchema.optional(),
  encounterId: RecordIdSchema.optional(),
  calendarEventIdentifier: NonEmptyTextSchema.optional(),
  calendarEventSnapshot: CalendarAppointmentSnapshotSchema.optional(),
}).superRefine((appointment, context) => {
  if (
    (appointment.calendarEventIdentifier === undefined) !==
    (appointment.calendarEventSnapshot === undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['calendarEventSnapshot'],
      message: 'A Calendar event identifier and snapshot must be stored together.',
    });
  }
  if (appointment.endsAt && compareTimestamps(appointment.endsAt, appointment.effectiveAt) < 0) {
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
  calendarEventIdentifier: NonEmptyTextSchema.optional(),
  calendarEventSnapshot: CalendarAppointmentSnapshotSchema.optional(),
}).superRefine((appointment, context) => {
  if (
    (appointment.calendarEventIdentifier === undefined) !==
    (appointment.calendarEventSnapshot === undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['calendarEventSnapshot'],
      message: 'A Calendar event identifier and snapshot must be stored together.',
    });
  }
});

export const AppointmentUpdateInputSchema = z
  .strictObject({
    effectiveAt: TimestampSchema.optional(),
    clinicLabel: NonEmptyTextSchema.optional(),
    note: NonEmptyTextSchema.nullable().optional(),
    endsAt: TimestampSchema.nullable().optional(),
    calendarEventIdentifier: NonEmptyTextSchema.nullable().optional(),
    calendarEventSnapshot: CalendarAppointmentSnapshotSchema.nullable().optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, 'Provide at least one appointment change.')
  .superRefine((changes, context) => {
    const hasIdentifier = changes.calendarEventIdentifier !== undefined;
    const hasSnapshot = changes.calendarEventSnapshot !== undefined;
    if (
      hasIdentifier !== hasSnapshot ||
      (hasIdentifier &&
        (changes.calendarEventIdentifier === null) !== (changes.calendarEventSnapshot === null))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['calendarEventSnapshot'],
        message: 'A Calendar event identifier and snapshot must be changed together.',
      });
    }
  });

export type AppointmentUpdateInput = z.input<typeof AppointmentUpdateInputSchema>;

function reviewStateAfterChange(appointment: Appointment): Appointment['reviewState'] {
  return appointment.reviewState.status === 'reviewed'
    ? { status: 'needs_review', reason: 'Appointment changed after review.' }
    : appointment.reviewState;
}

export function createAppointment(
  input: z.input<typeof AppointmentCreateInputSchema>,
): Appointment {
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
  if (parsedChanges.calendarEventIdentifier === null) {
    delete next.calendarEventIdentifier;
  }
  if (parsedChanges.calendarEventSnapshot === null) {
    delete next.calendarEventSnapshot;
  }
  if (
    (parsedChanges.effectiveAt !== undefined &&
      parsedChanges.effectiveAt !== appointment.effectiveAt) ||
    (parsedChanges.endsAt !== undefined &&
      parsedChanges.endsAt !== null &&
      parsedChanges.endsAt !== appointment.endsAt)
  ) {
    next.status = 'rescheduled';
  }
  next.recordedAt = recordedAt;
  next.ingestedAt = recordedAt;
  next.reviewState = reviewStateAfterChange(appointment);
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
    reviewState: reviewStateAfterChange(appointment),
  });
}

export const VisitBriefSchema = RecordMetadataSchema.safeExtend({
  encounterId: RecordIdSchema,
  summary: NonEmptyTextSchema,
  questionIds: UniqueRecordIdsSchema,
  evidenceSpanIds: UniqueRecordIdsSchema.min(1),
  medicationAssertionIds: UniqueRecordIdsSchema,
});

export type Appointment = z.infer<typeof AppointmentSchema>;
export type CalendarAppointmentSnapshot = z.infer<typeof CalendarAppointmentSnapshotSchema>;
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;
export type VisitBrief = z.infer<typeof VisitBriefSchema>;

// Preserve direct module imports for consumers that used the former schema location.
export { VisitQuestionSchema } from './visitQuestions';
export type { VisitQuestion } from './visitQuestions';
