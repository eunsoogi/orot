import { mapHealthKitSleepSample } from '../mapper';
import { healthKitSleepSample } from '../testFixtures';

describe('HealthKit sleep sample mapping', () => {
  it('maps every supported HealthKit category without losing its raw value', () => {
    const expected = new Map([
      [0, 'inBed'],
      [1, 'asleepUnspecified'],
      [2, 'awake'],
      [3, 'asleepCore'],
      [4, 'asleepDeep'],
      [5, 'asleepREM'],
    ]);

    for (const [categoryValue, stage] of expected) {
      const mapped = mapHealthKitSleepSample(
        healthKitSleepSample({ categoryValue }),
      );

      expect(mapped.categoryValue).toBe(categoryValue);
      expect(mapped.stage).toBe(stage);
    }
  });

  it('preserves source revision, optional device fields, timezone, and offset instants', () => {
    const input = healthKitSleepSample({
      startDate: '2026-11-01T01:00:00-07:00',
      endDate: '2026-11-01T01:30:00-08:00',
      device: {
        name: 'Watch',
        manufacturer: null,
        model: 'Watch 1',
        hardwareVersion: null,
        firmwareVersion: '2.0',
        softwareVersion: '27.0',
        localIdentifier: 'device-local-1',
        udiDeviceIdentifier: null,
      },
    });

    const mapped = mapHealthKitSleepSample(input);

    expect(mapped.source).toEqual({
      identifier: 'com.example.sleep',
      name: 'Example Sleep',
      revision: {
        version: '1.2',
        productType: null,
      },
    });
    expect(mapped.device).toEqual(input.device);
    expect(mapped.timeZone).toBe('America/Los_Angeles');
    expect(mapped.startDate).toBe(input.startDate);
    expect(mapped.endDate).toBe(input.endDate);
    expect(mapped.endEpochMs - mapped.startEpochMs).toBe(90 * 60 * 1000);
  });

  it('keeps an unknown integer category observable without assigning it a sleep stage', () => {
    const mapped = mapHealthKitSleepSample(
      healthKitSleepSample({ categoryValue: 99 }),
    );

    expect(mapped).toMatchObject({
      stage: 'unsupported',
      categoryValue: 99,
      id: 'sample-1',
    });
  });

  it('rejects malformed intervals, category values, and sample types', () => {
    expect(() =>
      mapHealthKitSleepSample(
        healthKitSleepSample({
          startDate: '2026-02-30T22:00:00Z',
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_SLEEP_INTERVAL' }));
    expect(() =>
      mapHealthKitSleepSample(healthKitSleepSample({ categoryValue: 2.5 })),
    ).toThrow(expect.objectContaining({ code: 'INVALID_SLEEP_CATEGORY' }));
    expect(() =>
      mapHealthKitSleepSample(
        healthKitSleepSample({
          typeIdentifier: 'HKQuantityTypeIdentifierStepCount',
        }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_SLEEP_SAMPLE_TYPE' }),
    );
  });

  it('preserves omitted and explicitly absent device metadata distinctly', () => {
    const omitted = mapHealthKitSleepSample(
      healthKitSleepSample({ device: undefined }),
    );
    const absent = mapHealthKitSleepSample(
      healthKitSleepSample({ device: null }),
    );

    expect(Object.prototype.hasOwnProperty.call(omitted, 'device')).toBe(false);
    expect(absent.device).toBeNull();
  });
});
