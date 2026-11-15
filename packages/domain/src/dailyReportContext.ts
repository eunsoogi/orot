import {
  DailyReportSourceRecordSchema,
  DailyReportSourceCoverageSchema,
} from './dailyReportSources';
export {
  DailyReportSourceRecordSchema,
  DailyReportSourceCoverageSchema,
  DailyReportCoverageStatusSchema,
} from './dailyReportSources';
import { validDailyReportBaseline } from './dailyReportBaseline';
import {
  DailyReportSystemCalendarSchema,
  validDailyReportSystemCalendar,
} from './dailyReportSystemCalendar';
import { validDailyReportSupportingContext } from './dailyReportSupportingContext';
import { z } from 'zod';
import { compareTimestamps, TimestampSchema } from './common';
import { dailyReportCalendarInterval } from './dailyReportCalendar';
import { DailyReportIdentitySchema } from './dailyReportIdentity';

const NonEmptyTextSchema = z.string().trim().min(1);

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
    systemCalendar: DailyReportSystemCalendarSchema.optional(),
  })
  .superRefine((value, context) => {
    const { interval, generationCutoff, effectiveCutoff, sourceSnapshot } = value;
    if (!validDailyReportSystemCalendar(value.systemCalendar, interval, sourceSnapshot.records))
      context.addIssue({
        code: 'custom',
        path: ['systemCalendar'],
        message: 'System calendar sources require an exact bounded binding.',
      });
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
      // A zero-length available window cannot include a cross-midnight occurrence.
      const hasAvailableWindow = compareTimestamps(effectiveCutoff, interval.fromInclusive) > 0;
      // Future appointments are known plans, never future measured health facts.
      const knownPlan =
        hasAvailableWindow &&
        record.source === 'appointment' &&
        compareTimestamps(startInclusive, interval.fromInclusive) >= 0 &&
        compareTimestamps(startInclusive, interval.toExclusive) < 0;
      const supporting = validDailyReportSupportingContext(
        record,
        sourceSnapshot.records,
        generationCutoff,
      );
      if (record.supportingRecordFor && !supporting)
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshot', 'records', index, 'supportingRecordFor'],
          message: 'Supporting medication context must reference admitted doses.',
        });
      const baseline = validDailyReportBaseline(
        record,
        value.identity.localDate,
        value.identity.timeZone,
      );
      if (record.contextRole && !baseline)
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshot', 'records', index, 'contextRole'],
          message: 'Invalid personal baseline time/source boundary.',
        });
      const overlaps =
        baseline ||
        supporting ||
        knownPlan ||
        (hasAvailableWindow &&
          (endExclusive
            ? compareTimestamps(startInclusive, effectiveCutoff) < 0 &&
              compareTimestamps(endExclusive, interval.fromInclusive) > 0
            : compareTimestamps(startInclusive, interval.fromInclusive) >= 0 &&
              compareTimestamps(startInclusive, effectiveCutoff) < 0));
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
