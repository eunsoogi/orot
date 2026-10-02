import { z } from 'zod';
import {
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
  if (
    assertion.endsAt &&
    compareTimestamps(assertion.endsAt, assertion.effectiveAt) < 0
  ) {
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

export const DoseEventSchema = RecordMetadataSchema.safeExtend({
  eventKind: z.enum(['taken', 'missed', 'administered']),
  medicationAssertionId: RecordIdSchema,
  dose: z
    .strictObject({ amount: z.number().positive().finite(), unit: NonEmptyTextSchema })
    .optional(),
});

export type PrescriptionAssertion = z.infer<typeof PrescriptionAssertionSchema>;
export type CurrentMedicationConfirmation = z.infer<typeof CurrentMedicationConfirmationSchema>;
export type MedicationAssertion = z.infer<typeof MedicationAssertionSchema>;
export type DoseEvent = z.infer<typeof DoseEventSchema>;
