import type { RecordRepository } from '@orot/storage';
import { healthKit } from '../../index';
import { importCommonObservations } from '../importer';
import { importLocalCommonObservations } from '../importLocal';
import { openLocalStorage } from '../../../storage/secureDatabase';

jest.mock('../importer', () => ({
  importCommonObservations: jest.fn(),
}));
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));

describe('local common-observation app importer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses only HealthKit read methods and the encrypted local record repository', async () => {
    const repository = {} as RecordRepository;
    const result = {
      status: 'complete' as const,
      readAuthorization: 'notObservable' as const,
      importedCount: 1,
      deletedCount: 0,
      unsupportedCount: 0,
      cursorAdvanced: true,
    };
    jest.mocked(openLocalStorage).mockResolvedValue(repository);
    jest.mocked(importCommonObservations).mockResolvedValue(result);

    await expect(importLocalCommonObservations(['heartRate'])).resolves.toEqual(
      result,
    );

    expect(Object.keys(healthKit)).toEqual([
      'getAvailability',
      'requestReadAuthorization',
      'querySamples',
      'queryMedicationDefinitions',
      'querySampleChanges',
    ]);
    expect(openLocalStorage).toHaveBeenCalledTimes(1);
    expect(importCommonObservations).toHaveBeenCalledWith(
      expect.objectContaining({
        features: ['heartRate'],
        healthKit,
        repository,
        now: expect.any(Function),
      }),
    );
    expect(
      jest.mocked(importCommonObservations).mock.calls[0]?.[0].now(),
    ).toMatch(/^\d{4}-\d\d-\d\dT/u);
  });
});
