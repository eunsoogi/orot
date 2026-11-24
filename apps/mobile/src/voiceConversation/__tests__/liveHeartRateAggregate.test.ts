import { liveHeartRateAggregate } from '../liveHeartRateAggregate';

test('wire projection excludes raw fields and requires three days of one unambiguous series', () => {
  const row = {
    concept: 'heart_rate',
    unit: 'count/min',
    recordedDays: 3,
    sampleCount: 4,
    meanOfRecordedDailyMeans: 72.6,
    latest: { occurredAt: '2099-01-01T12:01:02Z', amount: 701 },
    minimumSample: 181,
    maximumSample: 991,
    notes: 'distinctive private unstructured note',
  };
  const encode = (...quantities: unknown[]) =>
    'health_context: ' +
    JSON.stringify({
      topic: 'measurements',
      quantities,
      privateText: 'must never cross',
    });
  expect(liveHeartRateAggregate(encode(row), 7)).toEqual({
    topic: 'measurements',
    metric: 'heart_rate',
    unit: 'count/min',
    days: 7,
    sampleCount: 4,
    meanOfRecordedDailyMeans: 73,
  });
  expect(
    liveHeartRateAggregate(encode({ ...row, recordedDays: 1 }), 7),
  ).toBeUndefined();
  expect(liveHeartRateAggregate(encode(row, row), 7)).toBeUndefined();
  expect(
    liveHeartRateAggregate(encode({ ...row, sampleCount: 2 }), 7),
  ).toBeUndefined();
});
