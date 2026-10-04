import { z } from 'zod';
import {
  RecordIdSchema,
  RecordMetadataSchema,
  TimestampSchema,
  compareTimestamps,
} from './common';

const NonEmptyTextSchema = z.string().trim().min(1);
const NonNegativeIntegerSchema = z.number().int().min(0);
const PositiveIntegerSchema = z.number().int().positive();

export const SourceContentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const EvidenceSpanLocatorBaseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('audio_time_range'),
    startMs: NonNegativeIntegerSchema,
    endMs: NonNegativeIntegerSchema,
  }),
  z.strictObject({
    kind: z.literal('text_range'),
    startOffset: NonNegativeIntegerSchema,
    endOffset: NonNegativeIntegerSchema,
  }),
  z.strictObject({
    kind: z.literal('document_range'),
    pageNumber: PositiveIntegerSchema,
    startOffset: NonNegativeIntegerSchema,
    endOffset: NonNegativeIntegerSchema,
  }),
]);

/** Text and document offsets are zero-based UTF-16 code units with half-open ranges. */
export const EvidenceSpanLocatorSchema = EvidenceSpanLocatorBaseSchema.superRefine(
  (locator, context) => {
    const start = locator.kind === 'audio_time_range' ? locator.startMs : locator.startOffset;
    const end = locator.kind === 'audio_time_range' ? locator.endMs : locator.endOffset;
    if (end <= start) {
      context.addIssue({
        code: 'custom',
        path: [locator.kind === 'audio_time_range' ? 'endMs' : 'endOffset'],
        message: 'An evidence range must end after it starts.',
      });
    }
  },
);

export const SourceRecordSchema = RecordMetadataSchema.safeExtend({
  sourceKind: z.enum([
    'user_note',
    'caregiver_note',
    'clinician_note',
    'lab_report',
    'prescription',
    'imaging_report',
    'device_export',
    'audio_recording',
    'other',
  ]),
  title: NonEmptyTextSchema.optional(),
  externalReference: NonEmptyTextSchema.optional(),
  contentHash: SourceContentHashSchema.optional(),
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
  locator: EvidenceSpanLocatorSchema.optional(),
}).superRefine((span, context) => {
  if (!span.provenance.sourceRecordIds.includes(span.sourceRecordId)) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'sourceRecordIds'],
      message: 'The source record must also appear in provenance.sourceRecordIds.',
    });
  }
  if (
    span.locator?.kind === 'document_range' &&
    span.pageNumber !== undefined &&
    span.pageNumber !== span.locator.pageNumber
  ) {
    context.addIssue({
      code: 'custom',
      path: ['locator', 'pageNumber'],
      message: 'A document locator must match the legacy evidence page number.',
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
export type SourceContentHash = z.infer<typeof SourceContentHashSchema>;
export type EvidenceSpan = z.infer<typeof EvidenceSpanSchema>;
export type EvidenceSpanLocator = z.infer<typeof EvidenceSpanLocatorSchema>;
export type Encounter = z.infer<typeof EncounterSchema>;
export type ObservationValue = z.infer<typeof ObservationValueSchema>;
export type HealthObservation = z.infer<typeof HealthObservationSchema>;
export type SymptomEntry = z.infer<typeof SymptomEntrySchema>;
