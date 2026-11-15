import { z } from 'zod';
import { compareTimestamps, RecordIdSchema, TimestampSchema } from './common';
const NonEmptyTextSchema = z.string().trim().min(1);

export const DailyReportSourceRecordSchema = z
  .strictObject({
    source: NonEmptyTextSchema,
    recordId: RecordIdSchema,
    revision: NonEmptyTextSchema,
    occurrence: z.strictObject({
      startInclusive: TimestampSchema,
      endExclusive: TimestampSchema.optional(),
    }),
    ingestedAt: TimestampSchema,
    contextRole: z.literal('personal_baseline').optional(),
    supportingRecordFor: z.array(RecordIdSchema).min(1).max(100).optional(),
  })
  .superRefine((record, context) => {
    if (
      record.occurrence.endExclusive &&
      compareTimestamps(record.occurrence.startInclusive, record.occurrence.endExclusive) >= 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['occurrence', 'endExclusive'],
        message: 'An occurrence interval must advance.',
      });
    }
  });

export const DailyReportCoverageStatusSchema = z.enum([
  'available',
  'empty',
  'partial',
  'stale',
  'failed',
  'unknown',
]);

/** Coverage reports observed retrieval state; unknown does not imply denied access or an empty source. */
export const DailyReportSourceCoverageSchema = z
  .strictObject({
    source: NonEmptyTextSchema,
    status: DailyReportCoverageStatusSchema,
    syncStatus: z.enum(['complete', 'retryable', 'not_requested']).optional(),
    lastAttemptAt: TimestampSchema.optional(),
    lastSuccessfulAt: TimestampSchema.optional(),
    availableThrough: TimestampSchema.optional(),
    limitationCodes: z.array(NonEmptyTextSchema),
  })
  .superRefine((coverage, context) => {
    if (coverage.status === 'empty' && !coverage.lastSuccessfulAt) {
      context.addIssue({
        code: 'custom',
        path: ['lastSuccessfulAt'],
        message: 'Empty coverage requires a successful source read.',
      });
    }
    if (coverage.status === 'failed' && !coverage.lastAttemptAt) {
      context.addIssue({
        code: 'custom',
        path: ['lastAttemptAt'],
        message: 'Failed coverage requires an observed attempt.',
      });
    }
  });
