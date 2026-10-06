import type { RecordRepository } from '@orot/storage';
import { healthKit } from '../../index';
import { openLocalStorage } from '../../../storage/secureDatabase';
import { syncHealthKitBloodPressure } from '../sync';
import {
  importLocalBloodPressure,
  listLocalBloodPressureObservations,
} from '../importLocal';
import type { BloodPressureObservation } from '../types';

jest.mock('../../index', () => ({
  healthKit: { querySampleChanges: jest.fn() },
}));
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));
jest.mock('../sync', () => ({
  syncHealthKitBloodPressure: jest.fn(),
}));

describe('local blood-pressure storage boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the encrypted repository for explicit incremental import', async () => {
    const repository = {} as RecordRepository;
    const result = {
      status: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      upserted: 2,
      deleted: 0,
      cursorAdvanced: true,
    };
    jest.mocked(openLocalStorage).mockResolvedValue(repository);
    jest.mocked(syncHealthKitBloodPressure).mockResolvedValue(result);

    await expect(importLocalBloodPressure()).resolves.toEqual(result);
    expect(openLocalStorage).toHaveBeenCalledTimes(1);
    expect(syncHealthKitBloodPressure).toHaveBeenCalledWith(
      expect.objectContaining({
        healthKit,
        repository,
        now: expect.any(Function),
      }),
    );
    expect(
      jest.mocked(syncHealthKitBloodPressure).mock.calls[0]?.[0].now(),
    ).toMatch(/^\d{4}-\d\d-\d\dT/u);
  });

  it('loads only saved pressure components in newest-first order', async () => {
    const stored = [
      record('weight', 'body mass', '2026-10-06T00:00:00.000Z'),
      record(
        'systolic-old',
        'blood pressure systolic',
        '2026-10-01T00:00:00.000Z',
      ),
      record(
        'diastolic-new',
        'blood pressure diastolic',
        '2026-10-05T00:00:00.000Z',
      ),
    ];
    const repository = {
      list: jest.fn().mockResolvedValue(stored),
    } as unknown as RecordRepository;
    jest.mocked(openLocalStorage).mockResolvedValue(repository);

    await expect(listLocalBloodPressureObservations()).resolves.toEqual([
      stored[2],
      stored[1],
    ]);
    expect(repository.list).toHaveBeenCalledWith('health_observation');
  });

  it('shows systolic before diastolic when paired components share a time', async () => {
    const pairedAt = '2026-10-05T10:00:00.000Z';
    const stored = [
      record('diastolic', 'blood pressure diastolic', pairedAt),
      record('systolic', 'blood pressure systolic', pairedAt),
    ];
    jest.mocked(openLocalStorage).mockResolvedValue({
      list: jest.fn().mockResolvedValue(stored),
    } as unknown as RecordRepository);

    await expect(listLocalBloodPressureObservations()).resolves.toEqual([
      stored[1],
      stored[0],
    ]);
  });
});

function record(
  id: string,
  concept: string,
  effectiveAt: string,
): BloodPressureObservation {
  return { id, concept, effectiveAt } as BloodPressureObservation;
}
