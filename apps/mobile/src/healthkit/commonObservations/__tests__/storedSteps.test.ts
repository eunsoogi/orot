import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../mapper';
import { evaluateStoredStepAggregation } from '../steps';
import { healthKitSample } from '../testSupport';

function stepRecord(
  id: string,
  sourceIdentifier: string,
  startDate: string,
  endDate: string,
  value: number,
) {
  const mapped = mapCommonObservationSample(
    'steps',
    healthKitSample('steps', {
      id,
      sourceIdentifier,
      startDate,
      endDate,
      value,
    }),
  );
  if (mapped.status !== 'mapped')
    throw new Error('Expected a valid step sample.');
  return toCommonObservationRecord(
    mapped.observation,
    '2026-10-05T10:00:00.000Z',
  );
}

describe('stored common step aggregation', () => {
  it('refuses a cross-source sum when intervals overlap', () => {
    const result = evaluateStoredStepAggregation([
      stepRecord(
        'watch-1',
        'com.example.watch',
        '2026-10-04T10:00:00.000Z',
        '2026-10-04T10:10:00.000Z',
        120,
      ),
      stepRecord(
        'phone-1',
        'com.example.phone',
        '2026-10-04T10:05:00.000Z',
        '2026-10-04T10:15:00.000Z',
        100,
      ),
    ]);

    expect(result).toMatchObject({
      status: 'overlap',
      total: null,
      sampleIds: ['watch-1', 'phone-1'],
      sourceIdentifiers: ['com.example.phone', 'com.example.watch'],
    });
  });

  it('sums only valid non-overlapping intervals and keeps empty distinct from zero', () => {
    const first = stepRecord(
      'step-1',
      'com.example.watch',
      '2026-10-04T10:00:00.000Z',
      '2026-10-04T10:10:00.000Z',
      0,
    );
    const second = stepRecord(
      'step-2',
      'com.example.watch',
      '2026-10-04T10:10:00.000Z',
      '2026-10-04T10:20:00.000Z',
      10,
    );

    expect(evaluateStoredStepAggregation([first, second])).toMatchObject({
      status: 'safe',
      total: 10,
    });
    expect(evaluateStoredStepAggregation([])).toMatchObject({
      status: 'empty',
      total: null,
    });
  });
});
