import { compareHealthKitTimestamps, isValidHealthKitTimestamp } from '../time';

describe('HealthKit timestamp validation and ordering', () => {
  it('rejects impossible dates and times that Date.parse may normalize', () => {
    expect(isValidHealthKitTimestamp('2026-02-30T10:00:00.000Z')).toBe(false);
    expect(isValidHealthKitTimestamp('2026-10-04T24:00:00.000Z')).toBe(false);
    expect(isValidHealthKitTimestamp('2026-10-04T10:00:00.000+01:60')).toBe(
      false,
    );
  });

  it('orders submillisecond instants across timezone offsets', () => {
    const earlier = '2026-10-04T09:00:00.000100+01:00';
    const later = '2026-10-04T08:00:00.001000Z';

    expect(isValidHealthKitTimestamp(earlier)).toBe(true);
    expect(isValidHealthKitTimestamp(later)).toBe(true);
    expect(compareHealthKitTimestamps(earlier, later)).toBeLessThan(0);
    expect(
      compareHealthKitTimestamps(
        '2026-10-04T08:00:00.001100Z',
        '2026-10-04T08:00:00.0011000+00:00',
      ),
    ).toBe(0);
  });
});
