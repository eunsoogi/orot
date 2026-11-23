import { heartRateInstantBuckets } from '../heartRateInstantBuckets';

test('uses raw samples at the same exact instant, not an average of averages or adjacent samples', () => {
  const source = 'synthetic';
  expect(
    heartRateInstantBuckets([
      { x: '2035-01-01T00:00:00.0001Z', value: 60, source },
      { x: '2035-01-01T09:00:00.00010+09:00', value: 60, source },
      { x: '2035-01-01T00:00:00.0001Z', value: 120, source },
      { x: '2035-01-01T00:00:00.0002Z', value: 140, source },
    ]),
  ).toEqual([
    {
      x: '2035-01-01T00:00:00.0001Z',
      value: 80,
      source,
      range: { minimum: 60, maximum: 120, samples: 3 },
    },
    {
      x: '2035-01-01T00:00:00.0002Z',
      value: 140,
      source,
      range: { minimum: 140, maximum: 140, samples: 1 },
    },
  ]);
});
