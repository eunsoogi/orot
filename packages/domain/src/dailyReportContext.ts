import { z } from 'zod';
import { compareTimestamps, RecordIdSchema, TimestampSchema } from './common';
import { dailyReportCalendarInterval } from './dailyReportCalendar';
import { DailyReportIdentitySchema } from './dailyReportIdentity';

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

export const DailyReportProviderMetadataSchema = z.strictObject({
  providerId: NonEmptyTextSchema,
  modelId: NonEmptyTextSchema,
  modelVersion: NonEmptyTextSchema.optional(),
});

const DailyReportIntervalSchema = z
  .strictObject({
    fromInclusive: TimestampSchema,
    toExclusive: TimestampSchema,
  })
  .refine(
    (interval) => compareTimestamps(interval.fromInclusive, interval.toExclusive) < 0,
    'A daily interval must use advancing half-open bounds.',
  );

/** Immutable input metadata for a single generation snapshot. */
export const DailyReportContextSchema = z
  .strictObject({
    kind: z.literal('daily_report_context'),
    schemaVersion: z.literal(1),
    identity: DailyReportIdentitySchema,
    interval: DailyReportIntervalSchema,
    /** Actual explicit request time; effectiveCutoff is clamped to the day end. */
    generationCutoff: TimestampSchema,
    effectiveCutoff: TimestampSchema,
    sourceSnapshot: z.strictObject({
      revision: NonEmptyTextSchema,
      mutationGeneration: z.number().int().nonnegative().safe(),
      deletionGeneration: z.number().int().nonnegative().safe(),
      records: z.array(DailyReportSourceRecordSchema),
      coverage: z.array(DailyReportSourceCoverageSchema),
    }),
    provider: DailyReportProviderMetadataSchema,
  })
  .superRefine((value, context) => {
    const { interval, generationCutoff, effectiveCutoff, sourceSnapshot } = value;
    const expectedCutoff =
      compareTimestamps(generationCutoff, interval.toExclusive) < 0
        ? generationCutoff
        : interval.toExclusive;
    if (compareTimestamps(generationCutoff, interval.fromInclusive) < 0) {
      context.addIssue({
        code: 'custom',
        path: ['generationCutoff'],
        message: 'The generation cutoff cannot precede the requested day.',
      });
    }
    if (compareTimestamps(effectiveCutoff, expectedCutoff) !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveCutoff'],
        message: 'The effective cutoff must be clamped to the day interval.',
      });
    }
    if (sourceSnapshot.deletionGeneration > sourceSnapshot.mutationGeneration) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSnapshot', 'deletionGeneration'],
        message: 'Deletion generation cannot exceed mutation generation.',
      });
    }
    const expectedInterval = dailyReportCalendarInterval(
      value.identity.localDate,
      value.identity.timeZone,
    );
    if (
      !expectedInterval ||
      compareTimestamps(interval.fromInclusive, expectedInterval.fromInclusive) !== 0 ||
      compareTimestamps(interval.toExclusive, expectedInterval.toExclusive) !== 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['interval'],
        message: 'The report interval must match its local date and time zone.',
      });
    }

    const recordKeys = new Set<string>();
    for (const [index, record] of sourceSnapshot.records.entries()) {
      const key = record.source + ':' + record.recordId;
      if (recordKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshot', 'records', index, 'recordId'],
          message: 'A source record may appear only once in a snapshot.',
        });
      }
      recordKeys.add(key);
      if (compareTimestamps(record.ingestedAt, generationCutoff) > 0) {
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshot', 'records', index, 'ingestedAt'],
          message: 'A source record must exist by the generation cutoff.',
        });
      }
      const { startInclusive, endExclusive } = record.occurrence;
      const overlaps = endExclusive
        ? compareTimestamps(startInclusive, effectiveCutoff) < 0 &&
          compareTimestamps(endExclusive, interval.fromInclusive) > 0
        : compareTimestamps(startInclusive, interval.fromInclusive) >= 0 &&
          compareTimestamps(startInclusive, effectiveCutoff) < 0;
      if (!overlaps) {
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshot', 'records', index, 'occurrence'],
          message: 'A source record must overlap the available day interval.',
        });
      }
    }

    const coverageSources = new Set<string>();
    for (const [index, coverage] of sourceSnapshot.coverage.entries()) {
      if (coverageSources.has(coverage.source)) {
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshot', 'coverage', index, 'source'],
          message: 'Source coverage must be unique per source.',
        });
      }
      coverageSources.add(coverage.source);
      const observations = [
        coverage.lastAttemptAt,
        coverage.lastSuccessfulAt,
        coverage.availableThrough,
      ];
      if (
        observations.some((instant) => instant && compareTimestamps(instant, generationCutoff) > 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshot', 'coverage', index],
          message: 'Coverage evidence must be observed by the generation cutoff.',
        });
      }
    }
  });

export type DailyReportSourceRecord = z.infer<typeof DailyReportSourceRecordSchema>;
export type DailyReportSourceCoverage = z.infer<typeof DailyReportSourceCoverageSchema>;
export type DailyReportProviderMetadata = z.infer<typeof DailyReportProviderMetadataSchema>;
export type DailyReportContext = z.infer<typeof DailyReportContextSchema>;
