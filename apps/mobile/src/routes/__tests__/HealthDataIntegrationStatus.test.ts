import { healthKit } from '../../healthkit';
import { loadLocalHealthKitAutoSyncStatus } from '../../healthkit/autoSyncLocal';
import { loadHealthDataIntegrationStatus } from '../HealthDataIntegrationStatus';

jest.mock('../../healthkit', () => ({
  __esModule: true,
  healthKit: { getAvailability: jest.fn() },
}));
jest.mock('../../healthkit/autoSyncLocal', () => ({
  __esModule: true,
  loadLocalHealthKitAutoSyncStatus: jest.fn(),
}));

const lastSync = {
  status: 'complete' as const,
  updatedAt: '2026-10-27T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(healthKit.getAvailability).mockResolvedValue({
    status: 'available',
  });
  jest.mocked(loadLocalHealthKitAutoSyncStatus).mockResolvedValue(null);
});

test('reports unsupported HealthKit platforms as unavailable', async () => {
  jest.mocked(healthKit.getAvailability).mockResolvedValue({
    status: 'unsupportedPlatform',
  });

  await expect(loadHealthDataIntegrationStatus()).resolves.toEqual({
    availability: 'unavailable',
    lastSync: null,
    statusLoadFailed: false,
  });
  expect(healthKit.getAvailability).toHaveBeenCalledTimes(1);
  expect(loadLocalHealthKitAutoSyncStatus).toHaveBeenCalledTimes(1);
});

test('keeps a failed HealthKit availability read unknown', async () => {
  jest.mocked(loadLocalHealthKitAutoSyncStatus).mockResolvedValue(lastSync);
  jest
    .mocked(healthKit.getAvailability)
    .mockRejectedValue(new Error('HealthKit status unavailable'));

  await expect(loadHealthDataIntegrationStatus()).resolves.toEqual({
    availability: 'unknown',
    lastSync,
    statusLoadFailed: true,
  });
  expect(healthKit.getAvailability).toHaveBeenCalledTimes(1);
  expect(loadLocalHealthKitAutoSyncStatus).toHaveBeenCalledTimes(1);
});
