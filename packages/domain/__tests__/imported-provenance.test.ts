import { HealthObservationSchema } from '../src';
import { metadata } from './fixtures';

describe('imported HealthKit provenance', () => {
  it('keeps missing source time unknown and records unavailable original units', () => {
    const imported = HealthObservationSchema.parse({
      id: 'healthkit-observation-1',
      effectiveAt: '2026-10-01T08:00:00Z',
      endedAt: '2026-10-01T08:00:00Z',
      ingestedAt: '2026-10-01T08:02:00Z',
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['source-observation-1'],
        source: { system: 'healthkit' },
      },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'body mass',
      value: {
        kind: 'quantity',
        amount: 70,
        unit: 'kg',
        sourceRepresentation: {
          status: 'unavailable',
          reason: 'healthkit_does_not_expose_original_display_unit',
        },
      },
    });
    const manualWithoutRecordingTime = HealthObservationSchema.safeParse({
      ...metadata('manual-without-recording-time-1', {
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
      }),
      recordedAt: undefined,
      observationKind: 'measurement',
      concept: 'body mass',
      value: { kind: 'quantity', amount: 70, unit: 'kg' },
    });

    expect(imported).not.toHaveProperty('recordedAt');
    expect(imported.effectiveAt).toBe('2026-10-01T08:00:00Z');
    expect(imported.value).toMatchObject({
      kind: 'quantity',
      amount: 70,
      unit: 'kg',
      sourceRepresentation: {
        status: 'unavailable',
        reason: 'healthkit_does_not_expose_original_display_unit',
      },
    });
    expect(manualWithoutRecordingTime.success).toBe(false);
  });

  it('retains the derived-source requirement with optional imported source times', () => {
    const sourceFreeDerived = HealthObservationSchema.safeParse({
      ...metadata('derived-observation-without-source', {
        provenance: { origin: 'derived', sourceRecordIds: [] },
      }),
      observationKind: 'measurement',
      concept: 'sample measurement',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });
    const sourcedDerived = HealthObservationSchema.safeParse({
      ...metadata('derived-observation-with-source', {
        provenance: { origin: 'derived', sourceRecordIds: ['source-1'] },
      }),
      observationKind: 'measurement',
      concept: 'sample measurement',
      value: { kind: 'quantity', amount: 1, unit: 'unit' },
    });

    expect(sourceFreeDerived.success).toBe(false);
    expect(sourcedDerived.success).toBe(true);
  });
});
