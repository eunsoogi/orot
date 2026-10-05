import { evaluateStepAggregation } from '../steps';
import type { MappedCommonObservation } from '../types';

function step(
  sourceIdentifier: string,
  sourceSampleId: string,
  startDate: string,
  endDate: string,
  value: number,
): MappedCommonObservation {
  return {
    feature: 'steps',
    recordId: `healthkit:steps:${encodeURIComponent(sourceSampleId)}`,
    observationKind: 'measurement',
    concept: 'step_count',
    value: { kind: 'quantity', amount: value, unit: 'count' },
    sourceSampleId,
    typeIdentifier: 'HKQuantityTypeIdentifierStepCount',
    startDate,
    endDate,
    sourceIdentifier,
    sourceName: sourceIdentifier,
  };
}

describe('safe step aggregation', () => {
  it('keeps an empty query separate from a zero-step measurement', () => {
    expect(evaluateStepAggregation([])).toEqual({
      status: 'empty',
      total: null,
      sampleIds: [],
      sourceIdentifiers: [],
    });
    expect(
      evaluateStepAggregation([
        step(
          'com.example.watch',
          'zero-step-interval',
          '2026-10-04T08:00:00.000Z',
          '2026-10-04T09:00:00.000Z',
          0,
        ),
      ]),
    ).toMatchObject({ status: 'safe', total: 0 });
  });

  it('rejects impossible calendar dates even when JavaScript normalizes them', () => {
    expect(
      evaluateStepAggregation([
        step(
          'com.example.watch',
          'invalid-date',
          '2026-02-30T08:00:00.000Z',
          '2026-02-30T09:00:00.000Z',
          600,
        ),
      ]),
    ).toMatchObject({ status: 'invalid', total: null });
  });

  it('sums adjacent non-overlapping intervals', () => {
    const result = evaluateStepAggregation([
      step(
        'com.example.phone',
        'morning',
        '2026-10-04T08:00:00.000Z',
        '2026-10-04T09:00:00.000Z',
        500,
      ),
      step(
        'com.example.watch',
        'afternoon',
        '2026-10-04T09:00:00.000Z',
        '2026-10-04T10:00:00.000Z',
        900,
      ),
    ]);

    expect(result).toMatchObject({
      status: 'safe',
      total: 1400,
      sampleIds: ['morning', 'afternoon'],
    });
  });

  it('does not produce an aggregate for overlapping source intervals', () => {
    const result = evaluateStepAggregation([
      step(
        'com.example.phone',
        'phone',
        '2026-10-04T08:00:00.000Z',
        '2026-10-04T10:00:00.000Z',
        1200,
      ),
      step(
        'com.example.watch',
        'watch',
        '2026-10-04T09:00:00.000Z',
        '2026-10-04T11:00:00.000Z',
        1600,
      ),
    ]);

    expect(result).toMatchObject({
      status: 'overlap',
      total: null,
      sampleIds: ['phone', 'watch'],
      sourceIdentifiers: ['com.example.phone', 'com.example.watch'],
    });
  });

  it('detects a submillisecond overlap across timezone offsets', () => {
    const result = evaluateStepAggregation([
      step(
        'com.example.phone',
        'phone-submillisecond',
        '2026-10-04T09:00:00.000100+01:00',
        '2026-10-04T09:00:00.001100+01:00',
        100,
      ),
      step(
        'com.example.watch',
        'watch-submillisecond',
        '2026-10-04T08:00:00.001000Z',
        '2026-10-04T08:00:00.002000Z',
        120,
      ),
    ]);

    expect(result).toMatchObject({
      status: 'overlap',
      total: null,
      sampleIds: ['phone-submillisecond', 'watch-submillisecond'],
    });
  });

  it('keeps submillisecond intervals adjacent at an exact shared boundary', () => {
    const result = evaluateStepAggregation([
      step(
        'com.example.phone',
        'phone-adjacent',
        '2026-10-04T08:00:00.000100Z',
        '2026-10-04T08:00:00.001100Z',
        100,
      ),
      step(
        'com.example.watch',
        'watch-adjacent',
        '2026-10-04T08:00:00.001100Z',
        '2026-10-04T08:00:00.002000Z',
        120,
      ),
    ]);

    expect(result).toMatchObject({ status: 'safe', total: 220 });
  });

  it('collapses the same repeated sample before summing', () => {
    const sample = step(
      'com.example.watch',
      'stable-id',
      '2026-10-04T08:00:00.000Z',
      '2026-10-04T09:00:00.000Z',
      600,
    );

    expect(evaluateStepAggregation([sample, sample])).toMatchObject({
      status: 'safe',
      total: 600,
      sampleIds: ['stable-id'],
    });
  });

  it('refuses a repeated ID with conflicting values', () => {
    const original = step(
      'com.example.watch',
      'stable-id',
      '2026-10-04T08:00:00.000Z',
      '2026-10-04T09:00:00.000Z',
      600,
    );

    expect(
      evaluateStepAggregation([
        original,
        { ...original, value: { ...original.value, amount: 650 } },
      ]),
    ).toMatchObject({ status: 'conflictingDuplicate', total: null });
  });

  it('refuses a repeated ID with conflicting source provenance', () => {
    const original = step(
      'com.example.watch',
      'stable-id',
      '2026-10-04T08:00:00.000Z',
      '2026-10-04T09:00:00.000Z',
      600,
    );

    expect(
      evaluateStepAggregation([
        original,
        { ...original, sourceName: 'Renamed source' },
      ]),
    ).toMatchObject({ status: 'conflictingDuplicate', total: null });
  });
});
