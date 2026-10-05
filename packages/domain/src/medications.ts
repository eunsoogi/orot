import { z } from 'zod';
import {
  ImportedRecordMetadataSchema,
  ObservationIntervalSchema,
  RecordIdSchema,
  RecordMetadataSchema,
  TimestampSchema,
  compareTimestamps,
} from './common';

const NonEmptyTextSchema = z.string().trim().min(1);

const MedicationAssertionFieldsSchema = RecordMetadataSchema.safeExtend({
  medicationName: NonEmptyTextSchema,
  dosageInstruction: NonEmptyTextSchema.optional(),
  route: NonEmptyTextSchema.optional(),
});

export const PrescriptionAssertionSchema = MedicationAssertionFieldsSchema.safeExtend({
  assertionKind: z.literal('prescribed'),
  prescriberId: RecordIdSchema.optional(),
  endsAt: TimestampSchema.optional(),
}).superRefine((assertion, context) => {
  if (assertion.endsAt && compareTimestamps(assertion.endsAt, assertion.effectiveAt) < 0) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'endsAt must not precede effectiveAt.',
    });
  }
});

export const CurrentMedicationConfirmationSchema = MedicationAssertionFieldsSchema.safeExtend({
  assertionKind: z.literal('current_medication_confirmation'),
  confirmedByUserId: RecordIdSchema,
}).superRefine((confirmation, context) => {
  if (confirmation.provenance.origin !== 'user_reported') {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'origin'],
      message: 'Current medication confirmations must be user-reported.',
    });
  }
});

export const MedicationAssertionSchema = z.discriminatedUnion('assertionKind', [
  PrescriptionAssertionSchema,
  CurrentMedicationConfirmationSchema,
]);

/** HealthKit's medication catalog omits source creation and record timestamps. */
export const MedicationDefinitionSchema = ImportedRecordMetadataSchema.safeExtend({
  medicationConceptIdentifier: RecordIdSchema,
  displayText: NonEmptyTextSchema,
  generalForm: NonEmptyTextSchema,
  nickname: NonEmptyTextSchema.optional(),
  isArchived: z.boolean(),
  hasSchedule: z.boolean(),
});

const AssertedDoseEventSchema = RecordMetadataSchema.safeExtend({
  eventKind: z.enum(['taken', 'missed', 'administered']),
  medicationAssertionId: RecordIdSchema,
  dose: z
    .strictObject({ amount: z.number().positive().finite(), unit: NonEmptyTextSchema })
    .optional(),
});

// Preserve explicit HealthKit statuses; an absent dose event is not a missed-dose status.
export const DoseObservationStatusSchema = z.enum([
  'not_interacted',
  'notification_not_sent',
  'snoozed',
  'taken',
  'skipped',
  'not_logged',
  'unknown',
]);

const ImportedDoseEventSchema = ImportedRecordMetadataSchema.safeExtend({
  effectiveAt: TimestampSchema,
  ...ObservationIntervalSchema.shape,
  eventKind: z.literal('observed'),
  medicationDefinitionId: RecordIdSchema,
  scheduledAt: TimestampSchema.optional(),
  observationStatus: DoseObservationStatusSchema,
  sourceStatusCode: z.number().int().optional(),
  sourceScheduleTypeCode: z.number().int().optional(),
  scheduleType: z.enum(['as_needed', 'scheduled']).optional(),
  dose: z
    .strictObject({
      amount: z.number().nonnegative().finite().optional(),
      unit: NonEmptyTextSchema,
    })
    .optional(),
}).superRefine((event, context) => {
  if (event.endedAt && compareTimestamps(event.endedAt, event.effectiveAt) < 0) {
    context.addIssue({
      code: 'custom',
      path: ['endedAt'],
      message: 'endedAt must not precede effectiveAt.',
    });
  }
});

export const DoseEventSchema = z.discriminatedUnion('eventKind', [
  AssertedDoseEventSchema,
  ImportedDoseEventSchema,
]);

export type PrescriptionAssertion = z.infer<typeof PrescriptionAssertionSchema>;
export type CurrentMedicationConfirmation = z.infer<typeof CurrentMedicationConfirmationSchema>;
export type MedicationAssertion = z.infer<typeof MedicationAssertionSchema>;
export type MedicationDefinition = z.infer<typeof MedicationDefinitionSchema>;
export type DoseObservationStatus = z.infer<typeof DoseObservationStatusSchema>;
export type DoseEvent = z.infer<typeof DoseEventSchema>;
