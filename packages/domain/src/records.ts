import { z } from 'zod';
import {
  RecordIdSchema,
  RecordMetadataSchema,
  TimestampSchema,
  compareTimestamps,
} from './common';

const NonEmptyTextSchema = z.string().trim().min(1);

export const SourceRecordSchema = RecordMetadataSchema.safeExtend({
  sourceKind: z.enum([
    'user_note',
    'caregiver_note',
    'clinician_note',
    'lab_report',
    'prescription',
    'imaging_report',
    'device_export',
    'other',
  ]),
  title: NonEmptyTextSchema.optional(),
  externalReference: NonEmptyTextSchema.optional(),
}).superRefine((record, context) => {
  if (record.provenance.origin === 'derived') {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'origin'],
      message: 'A source record cannot be derived from another record.',
    });
  }
});

export const EvidenceSpanSchema = RecordMetadataSchema.safeExtend({
  sourceRecordId: RecordIdSchema,
  text: NonEmptyTextSchema,
  pageNumber: z.number().int().positive().optional(),
}).superRefine((span, context) => {
  if (!span.provenance.sourceRecordIds.includes(span.sourceRecordId)) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'sourceRecordIds'],
      message: 'The source record must also appear in provenance.sourceRecordIds.',
    });
  }
});

export const EncounterSchema = RecordMetadataSchema.safeExtend({
  encounterKind: z.enum([
    'outpatient',
    'urgent_care',
    'emergency',
    'inpatient',
    'telehealth',
    'other',
  ]),
  endedAt: TimestampSchema.optional(),
  summary: NonEmptyTextSchema.optional(),
}).superRefine((encounter, context) => {
  if (
    encounter.endedAt &&
    compareTimestamps(encounter.endedAt, encounter.effectiveAt) < 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['endedAt'],
      message: 'endedAt must not precede effectiveAt.',
    });
  }
});

export const ObservationValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('quantity'),
    amount: z.number().finite(),
    unit: NonEmptyTextSchema,
  }),
  z.strictObject({ kind: z.literal('text'), text: NonEmptyTextSchema }),
  z.strictObject({ kind: z.literal('boolean'), value: z.boolean() }),
]);

export const HealthObservationSchema = RecordMetadataSchema.safeExtend({
  observationKind: z.enum(['measurement', 'diagnosis', 'allergy', 'procedure', 'other']),
  concept: NonEmptyTextSchema,
  value: ObservationValueSchema,
});

export const SymptomEntrySchema = RecordMetadataSchema.safeExtend({
  description: NonEmptyTextSchema,
  bodySite: NonEmptyTextSchema.optional(),
  severity: z.number().int().min(0).max(10).optional(),
  resolvedAt: TimestampSchema.optional(),
}).superRefine((symptom, context) => {
  if (
    symptom.resolvedAt &&
    compareTimestamps(symptom.resolvedAt, symptom.effectiveAt) < 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['resolvedAt'],
      message: 'resolvedAt must not precede effectiveAt.',
    });
  }
});

export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type EvidenceSpan = z.infer<typeof EvidenceSpanSchema>;
export type Encounter = z.infer<typeof EncounterSchema>;
export type ObservationValue = z.infer<typeof ObservationValueSchema>;
export type HealthObservation = z.infer<typeof HealthObservationSchema>;
export type SymptomEntry = z.infer<typeof SymptomEntrySchema>;
