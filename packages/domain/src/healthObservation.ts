import { z } from 'zod';
import {
  ImportedRecordMetadataSchema,
  ObservationIntervalSchema,
  TimestampSchema,
  compareTimestamps,
} from './common';

const NonEmptyTextSchema = z.string().trim().min(1);
const HeartRateSampleSummarySchema = z.strictObject({
  minimum: z.number().positive().finite(),
  maximum: z.number().positive().finite(),
  mean: z.number().positive().finite(),
  count: z.number().int().min(2).max(1_000_000),
});

export const ObservationValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('quantity'),
    amount: z.number().finite(),
    unit: NonEmptyTextSchema,
    // Keep a source-reported representation separate from normalized query units.
    sourceRepresentation: z
      .discriminatedUnion('status', [
        z.strictObject({
          status: z.literal('available'),
          amount: z.number().finite(),
          unit: NonEmptyTextSchema,
        }),
        z.strictObject({
          status: z.literal('unavailable'),
          reason: NonEmptyTextSchema,
        }),
      ])
      .optional(),
  }),
  z.strictObject({ kind: z.literal('text'), text: NonEmptyTextSchema }),
  z.strictObject({ kind: z.literal('boolean'), value: z.boolean() }),
]);

export const HealthObservationSchema = ImportedRecordMetadataSchema.safeExtend({
  effectiveAt: TimestampSchema,
  ...ObservationIntervalSchema.shape,
  observationKind: z.enum(['measurement', 'diagnosis', 'allergy', 'procedure', 'other']),
  concept: NonEmptyTextSchema,
  value: ObservationValueSchema,
  /** Optional exact HealthKit discrete source statistics; never inferred from generic BPM. */
  heartRateSampleSummary: HeartRateSampleSummarySchema.optional(),
  // Preserve the source activity code without inferring intensity or requesting location routes.
  workout: z
    .strictObject({
      activityType: z.number().int().nonnegative(),
      activityName: NonEmptyTextSchema,
    })
    .optional(),
}).superRefine((observation, context) => {
  const summary = observation.heartRateSampleSummary;
  if (
    summary &&
    ((observation.concept !== 'resting_heart_rate' &&
      observation.concept !== 'walking_heart_rate_average') ||
      observation.observationKind !== 'measurement' ||
      observation.provenance.origin !== 'imported' ||
      observation.provenance.source?.system !== 'healthkit' ||
      !observation.endedAt ||
      observation.value.kind !== 'quantity' ||
      observation.value.unit !== 'count/min' ||
      observation.value.amount !== summary.mean ||
      summary.minimum > summary.mean ||
      summary.mean > summary.maximum)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['heartRateSampleSummary'],
      message: 'Invalid Apple-derived heart-rate source statistics.',
    });
  }
  if (!observation.recordedAt && observation.provenance.origin !== 'imported') {
    context.addIssue({
      code: 'custom',
      path: ['recordedAt'],
      message: 'A missing recordedAt is only valid when the source does not provide it.',
    });
  }
  if (
    observation.recordedAt &&
    observation.reviewState.status === 'reviewed' &&
    compareTimestamps(observation.reviewState.reviewedAt, observation.recordedAt) < 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reviewState', 'reviewedAt'],
      message: 'reviewedAt must not precede recordedAt.',
    });
  }
  if (observation.endedAt && compareTimestamps(observation.endedAt, observation.effectiveAt) < 0) {
    context.addIssue({
      code: 'custom',
      path: ['endedAt'],
      message: 'endedAt must not precede effectiveAt.',
    });
  }
});

export type ObservationValue = z.infer<typeof ObservationValueSchema>;
export type QuantitySourceRepresentation = Extract<
  ObservationValue,
  { kind: 'quantity' }
>['sourceRepresentation'];
export type HealthObservation = z.infer<typeof HealthObservationSchema>;
