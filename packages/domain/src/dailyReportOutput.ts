import { z } from 'zod';
import { RecordIdSchema, TimestampSchema } from './common';
import { DailyReportIdentitySchema } from './dailyReportIdentity';
import { DailyReportSourceCoverageSchema } from './dailyReportContext';

const NonEmptyTextSchema = z.string().trim().min(1);

const DailyReportSourceReferenceSchema = z.strictObject({
  source: NonEmptyTextSchema,
  recordId: RecordIdSchema,
});

const DailyReportClaimSchema = z.strictObject({
  text: NonEmptyTextSchema,
  sourceReferences: z.array(DailyReportSourceReferenceSchema).min(1),
});

/** Save-ready output keeps factual statements linked to the input snapshot. */
export const DailyReportOutputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  identity: DailyReportIdentitySchema,
  generatedAt: TimestampSchema,
  observations: z.array(DailyReportClaimSchema),
  supportedContext: z.array(DailyReportClaimSchema),
  coverage: z.array(DailyReportSourceCoverageSchema),
  followUpQuestions: z.array(NonEmptyTextSchema),
});

export const DailyReportFailureCodeSchema = z.enum([
  'invalid_context',
  'source_unavailable',
  'source_stale',
  'source_revision_changed',
  'provider_unavailable',
  'consent_required',
  'cancelled',
  'timeout',
  'partial_stream',
  'malformed_output',
]);

/** Incomplete generation is a failure result and cannot be saved as a report. */
export const DailyReportGenerationResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('completed'),
    report: DailyReportOutputSchema,
  }),
  z.strictObject({
    status: z.literal('failed'),
    code: DailyReportFailureCodeSchema,
    retryable: z.boolean(),
  }),
]);

export type DailyReportOutput = z.infer<typeof DailyReportOutputSchema>;
export type DailyReportFailureCode = z.infer<typeof DailyReportFailureCodeSchema>;
export type DailyReportGenerationResult = z.infer<typeof DailyReportGenerationResultSchema>;
