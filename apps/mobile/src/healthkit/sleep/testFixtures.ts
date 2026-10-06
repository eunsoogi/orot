import type { HealthKitSleepSampleSnapshot } from './types';

export function healthKitSleepSample(
  overrides: Partial<HealthKitSleepSampleSnapshot> = {},
): HealthKitSleepSampleSnapshot {
  return {
    id: 'sample-1',
    typeIdentifier: 'HKCategoryTypeIdentifierSleepAnalysis',
    startDate: '2026-10-01T22:00:00.000Z',
    endDate: '2026-10-01T23:00:00.000Z',
    categoryValue: 3,
    sourceIdentifier: 'com.example.sleep',
    sourceName: 'Example Sleep',
    sourceVersion: '1.2',
    sourceProductType: null,
    device: {
      name: 'Watch',
      manufacturer: 'Example',
      model: 'Watch 1',
      hardwareVersion: null,
      firmwareVersion: '2.0',
      softwareVersion: '27.0',
      localIdentifier: 'device-local-1',
      udiDeviceIdentifier: null,
    },
    timeZone: 'America/Los_Angeles',
    ...overrides,
  };
}
