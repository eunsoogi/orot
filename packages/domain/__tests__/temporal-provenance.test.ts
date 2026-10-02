import { describe, expect, it } from '@jest/globals';
import {
  AppointmentSchema,
  EvidenceSpanSchema,
  HealthObservationSchema,
  ReviewStateSchema,
  SourceRecordSchema,
  VisitBriefSchema,
} from '../src';
import { metadata } from './fixtures';

describe('record time, provenance, and review validation', () => {
  it('requires explicit timestamps, provenance, and review state', () => {
    const incomplete = metadata('incomplete-1');
    delete incomplete.ingestedAt;
    delete incomplete.provenance;
    delete incomplete.reviewState;

    expect(SourceRecordSchema.safeParse({ ...incomplete, sourceKind: 'other' }).success).toBe(
      false,
    );
  });

  it('rejects an ingestion time earlier than recording time', () => {
    const result = HealthObservationSchema.safeParse({
      ...metadata('bad-order-1', {
        recordedAt: '2026-02-03T09:20:00Z',
        ingestedAt: '2026-02-03T09:19:00Z',
      }),
      observationKind: 'measurement',
      concept: 'sample',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(issue => issue.path.join('.') === 'ingestedAt')).toBe(true);
    }
  });

  it('compares fractional seconds beyond milliseconds and equivalent offsets exactly', () => {
    const reversedFraction = HealthObservationSchema.safeParse({
      ...metadata('submillisecond-order-1', {
        recordedAt: '2026-01-01T00:00:00.0002Z',
        ingestedAt: '2026-01-01T00:00:00.0001Z',
      }),
      observationKind: 'measurement',
      concept: 'sample',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });
    const equivalentOffsets = HealthObservationSchema.safeParse({
      ...metadata('equivalent-offsets-1', {
        recordedAt: '2026-01-01T01:00:00.000100+01:00',
        ingestedAt: '2026-01-01T00:00:00.0001Z',
      }),
      observationKind: 'measurement',
      concept: 'sample',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });
    const adjacentMillis = HealthObservationSchema.safeParse({
      ...metadata('fractional-millisecond-boundary-1', {
        recordedAt: '2026-01-01T00:00:00.0009999Z',
        ingestedAt: '2026-01-01T00:00:00.0010000Z',
      }),
      observationKind: 'measurement',
      concept: 'sample',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });

    expect(reversedFraction.success).toBe(false);
    expect(equivalentOffsets.success).toBe(true);
    expect(adjacentMillis.success).toBe(true);
  });

  it('allows backfilled facts and future appointments', () => {
    const observation = HealthObservationSchema.parse({
      ...metadata('backfilled-1', { effectiveAt: '2024-10-01T08:00:00Z' }),
      observationKind: 'measurement',
      concept: 'sample measurement',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });
    const appointment = AppointmentSchema.parse({
      ...metadata('future-appointment-1', { effectiveAt: '2027-03-01T10:00:00-05:00' }),
      status: 'scheduled',
    });

    expect(observation.effectiveAt).toBe('2024-10-01T08:00:00Z');
    expect(appointment.effectiveAt).toBe('2027-03-01T10:00:00-05:00');
  });

  it('requires derived records to cite sources and evidence spans to match their source', () => {
    const briefWithoutSource = VisitBriefSchema.safeParse({
      ...metadata('brief-no-source-1', {
        provenance: { origin: 'derived', sourceRecordIds: [] },
      }),
      encounterId: 'encounter-1',
      summary: 'Synthetic summary.',
      questionIds: [],
      evidenceSpanIds: ['evidence-1'],
      medicationAssertionIds: [],
    });
    const evidenceWithWrongSource = EvidenceSpanSchema.safeParse({
      ...metadata('evidence-wrong-source-1', {
        provenance: { origin: 'imported', sourceRecordIds: ['source-1'] },
      }),
      sourceRecordId: 'source-2',
      text: 'Synthetic excerpt.',
    });
    const duplicateSources = HealthObservationSchema.safeParse({
      ...metadata('duplicate-sources-1', {
        provenance: { origin: 'imported', sourceRecordIds: ['source-1', 'source-1'] },
      }),
      observationKind: 'measurement',
      concept: 'sample',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });

    expect(briefWithoutSource.success).toBe(false);
    expect(evidenceWithWrongSource.success).toBe(false);
    expect(duplicateSources.success).toBe(false);
  });

  it('requires a reviewer identity and a review time no earlier than recording', () => {
    const valid = HealthObservationSchema.safeParse({
      ...metadata('reviewed-1', {
        reviewState: {
          status: 'reviewed',
          reviewerId: 'reviewer-1',
          reviewedAt: '2026-02-03T09:06:00-05:00',
        },
      }),
      observationKind: 'measurement',
      concept: 'sample measurement',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });
    const invalid = HealthObservationSchema.safeParse({
      ...metadata('review-before-record-1', {
        reviewState: {
          status: 'reviewed',
          reviewerId: 'reviewer-1',
          reviewedAt: '2026-02-03T09:04:00-05:00',
        },
      }),
      observationKind: 'measurement',
      concept: 'sample measurement',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });
    const invalidSubmillisecond = HealthObservationSchema.safeParse({
      ...metadata('review-before-record-submillisecond-1', {
        recordedAt: '2026-01-01T00:00:00.0002Z',
        reviewState: {
          status: 'reviewed',
          reviewerId: 'reviewer-1',
          reviewedAt: '2026-01-01T00:00:00.0001Z',
        },
      }),
      observationKind: 'measurement',
      concept: 'sample measurement',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
    expect(invalidSubmillisecond.success).toBe(false);
    expect(ReviewStateSchema.safeParse({ status: 'needs_review' }).success).toBe(false);
  });
});
