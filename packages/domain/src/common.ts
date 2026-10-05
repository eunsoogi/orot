import { z } from 'zod';

export const RecordIdSchema = z.string().trim().min(1);
export const TimestampSchema = z.iso.datetime({ offset: true });

function submillisecondDigits(timestamp: string): string {
  const fraction = timestamp.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/i)?.[1] ?? '';
  return fraction.slice(3);
}

export function compareTimestamps(left: string, right: string): number {
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);

  if (leftMilliseconds !== rightMilliseconds) {
    return leftMilliseconds < rightMilliseconds ? -1 : 1;
  }

  const leftFraction = submillisecondDigits(left);
  const rightFraction = submillisecondDigits(right);
  const precision = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(precision, '0');
  const normalizedRight = rightFraction.padEnd(precision, '0');

  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

export const ProvenanceOriginSchema = z.enum([
  'user_reported',
  'caregiver_reported',
  'clinician_recorded',
  'device_recorded',
  'imported',
  'derived',
]);

const NonEmptyTextSchema = z.string().trim().min(1);

export const ProvenanceSourceSchema = z.strictObject({
  system: NonEmptyTextSchema,
  sourceIdentifier: NonEmptyTextSchema.optional(),
  sourceName: NonEmptyTextSchema.optional(),
  sourceVersion: NonEmptyTextSchema.optional(),
  productType: NonEmptyTextSchema.optional(),
  device: z
    .strictObject({
      manufacturer: NonEmptyTextSchema.optional(),
      model: NonEmptyTextSchema.optional(),
      hardwareVersion: NonEmptyTextSchema.optional(),
      softwareVersion: NonEmptyTextSchema.optional(),
    })
    .optional(),
});

export const ProvenanceSchema = z.strictObject({
  origin: ProvenanceOriginSchema,
  sourceRecordIds: z
    .array(RecordIdSchema)
    .refine((ids) => new Set(ids).size === ids.length, 'Source record IDs must be unique.'),
  source: ProvenanceSourceSchema.optional(),
});

export const ReviewStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unreviewed') }),
  z.strictObject({
    status: z.literal('needs_review'),
    reason: z.string().trim().min(1),
  }),
  z.strictObject({
    status: z.literal('reviewed'),
    reviewerId: RecordIdSchema,
    reviewedAt: TimestampSchema,
  }),
]);

export const RecordMetadataSchema = z
  .strictObject({
    id: RecordIdSchema,
    effectiveAt: TimestampSchema,
    recordedAt: TimestampSchema,
    ingestedAt: TimestampSchema,
    provenance: ProvenanceSchema,
    reviewState: ReviewStateSchema,
  })
  .superRefine((record, context) => {
    if (compareTimestamps(record.recordedAt, record.ingestedAt) > 0) {
      context.addIssue({
        code: 'custom',
        path: ['ingestedAt'],
        message: 'ingestedAt must not precede recordedAt.',
      });
    }

    if (record.provenance.origin === 'derived' && record.provenance.sourceRecordIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'sourceRecordIds'],
        message: 'Derived records must identify at least one source record.',
      });
    }

    if (
      record.reviewState.status === 'reviewed' &&
      compareTimestamps(record.reviewState.reviewedAt, record.recordedAt) < 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reviewState', 'reviewedAt'],
        message: 'reviewedAt must not precede recordedAt.',
      });
    }
  });

// Some imported HealthKit objects expose event dates but no source creation date.
// Keep those source times optional instead of filling them with the local ingest time.
export const ImportedRecordMetadataSchema = z
  .strictObject({
    id: RecordIdSchema,
    effectiveAt: TimestampSchema.optional(),
    recordedAt: TimestampSchema.optional(),
    ingestedAt: TimestampSchema,
    provenance: ProvenanceSchema,
    reviewState: ReviewStateSchema,
  })
  .superRefine((record, context) => {
    if (record.recordedAt && compareTimestamps(record.recordedAt, record.ingestedAt) > 0) {
      context.addIssue({
        code: 'custom',
        path: ['ingestedAt'],
        message: 'ingestedAt must not precede recordedAt.',
      });
    }
  });

export const ObservationIntervalSchema = z.strictObject({
  endedAt: TimestampSchema.optional(),
});

export type RecordId = z.infer<typeof RecordIdSchema>;
export type Timestamp = z.infer<typeof TimestampSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ProvenanceSource = z.infer<typeof ProvenanceSourceSchema>;
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export type RecordMetadata = z.infer<typeof RecordMetadataSchema>;
export type ImportedRecordMetadata = z.infer<typeof ImportedRecordMetadataSchema>;
export type ObservationInterval = z.infer<typeof ObservationIntervalSchema>;
