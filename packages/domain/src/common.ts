import { z } from 'zod';

export const RecordIdSchema = z.string().trim().min(1);
export const TimestampSchema = z.iso.datetime({ offset: true });

export const ProvenanceOriginSchema = z.enum([
  'user_reported',
  'caregiver_reported',
  'clinician_recorded',
  'device_recorded',
  'imported',
  'derived',
]);

export const ProvenanceSchema = z.strictObject({
  origin: ProvenanceOriginSchema,
  sourceRecordIds: z
    .array(RecordIdSchema)
    .refine(ids => new Set(ids).size === ids.length, 'Source record IDs must be unique.'),
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
    if (Date.parse(record.recordedAt) > Date.parse(record.ingestedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['ingestedAt'],
        message: 'ingestedAt must not precede recordedAt.',
      });
    }

    if (
      record.provenance.origin === 'derived' &&
      record.provenance.sourceRecordIds.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'sourceRecordIds'],
        message: 'Derived records must identify at least one source record.',
      });
    }

    if (
      record.reviewState.status === 'reviewed' &&
      Date.parse(record.reviewState.reviewedAt) < Date.parse(record.recordedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reviewState', 'reviewedAt'],
        message: 'reviewedAt must not precede recordedAt.',
      });
    }
  });

export type RecordId = z.infer<typeof RecordIdSchema>;
export type Timestamp = z.infer<typeof TimestampSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export type RecordMetadata = z.infer<typeof RecordMetadataSchema>;
