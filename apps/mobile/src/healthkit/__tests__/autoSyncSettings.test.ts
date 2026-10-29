import { configureHealthKitAutoSync } from '../autoSyncSettings';
import {
  healthKitAutoSyncCheckpointKey,
  loadHealthKitAutoSyncSelection,
  loadHealthKitAutoSyncStatus,
} from '../autoSyncCheckpoint';
import { MemoryObservationRepository } from '../commonObservations/testSupport';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import { page, sample } from '../sleep/sleepImporterFixtures';

const now = '2026-10-18T12:00:00.000Z';

test('stores the selection before requesting access and syncs selected records', async () => {
  const repository = new MemoryObservationRepository();
  const requestReadAuthorizations = jest.fn(async () => {
    expect(
      await repository.getSyncCheckpoint(
        healthKitAutoSyncCheckpointKey('sleep'),
      ),
    ).toMatchObject({ value: 'requested' });
    return {
      availability: 'available' as const,
      requestStatus: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      requestedFeatures: ['sleep'] as const,
      unsupportedFeatures: [],
    };
  });
  const querySampleChanges = jest.fn(async () =>
    page([sample('night')], 'sleep-anchor'),
  );

  await expect(
    configureHealthKitAutoSync(['sleep'], {
      repository,
      healthKit: { requestReadAuthorizations, querySampleChanges },
      now: () => now,
    }),
  ).resolves.toEqual({ status: 'complete', attemptedFeatures: ['sleep'] });

  expect(requestReadAuthorizations).toHaveBeenCalledWith(['sleep']);
  expect(querySampleChanges).toHaveBeenCalledTimes(1);
  await expect(loadHealthKitAutoSyncSelection(repository)).resolves.toEqual([
    'sleep',
  ]);
  await expect(loadHealthKitAutoSyncStatus(repository)).resolves.toMatchObject({
    status: 'complete',
    updatedAt: now,
  });
});

test('saves disabled choices without requesting access or deleting sample cursors', async () => {
  const repository = new MemoryObservationRepository();
  const querySampleChanges = jest.fn();
  const requestReadAuthorizations = jest.fn();
  const sleepCursorKey = healthKitSampleChangesCheckpointKey('sleep', 'sleep');
  await repository.transaction(writer =>
    writer.putSyncCheckpoint({
      key: sleepCursorKey,
      value: 'sleep-anchor',
      updatedAt: now,
    }),
  );

  await expect(
    configureHealthKitAutoSync([], {
      repository,
      healthKit: { requestReadAuthorizations, querySampleChanges },
      now: () => now,
    }),
  ).resolves.toEqual({ status: 'skipped', attemptedFeatures: [] });

  expect(requestReadAuthorizations).not.toHaveBeenCalled();
  expect(querySampleChanges).not.toHaveBeenCalled();
  await expect(loadHealthKitAutoSyncSelection(repository)).resolves.toEqual([]);
  await expect(
    repository.getSyncCheckpoint(sleepCursorKey),
  ).resolves.toMatchObject({ value: 'sleep-anchor' });
});

test('reports a selection persistence failure before requesting HealthKit access', async () => {
  const repository = new MemoryObservationRepository();
  jest
    .spyOn(repository, 'transaction')
    .mockRejectedValue(new Error('encrypted store unavailable'));
  const requestReadAuthorizations = jest.fn();

  await expect(
    configureHealthKitAutoSync(['sleep'], {
      repository,
      healthKit: {
        requestReadAuthorizations,
        querySampleChanges: jest.fn(),
      },
      now: () => now,
    }),
  ).resolves.toEqual({
    status: 'selection_save_failed',
    attemptedFeatures: [],
  });
  expect(requestReadAuthorizations).not.toHaveBeenCalled();
});

test('repeats authorization for an unchanged selection already in saved checkpoints', async () => {
  const repository = new MemoryObservationRepository();
  await repository.transaction(writer =>
    writer.putSyncCheckpoint({
      key: healthKitAutoSyncCheckpointKey('sleep'),
      value: 'requested',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }),
  );
  const requestReadAuthorizations = jest.fn(async () => ({
    availability: 'available' as const,
    requestStatus: 'completed' as const,
    readAuthorization: 'notObservable' as const,
    requestedFeatures: ['sleep'] as const,
    unsupportedFeatures: [],
  }));

  await expect(
    configureHealthKitAutoSync(['sleep'], {
      repository,
      healthKit: {
        requestReadAuthorizations,
        querySampleChanges: jest.fn(async () => page([], 'sleep-anchor')),
      },
      now: () => now,
    }),
  ).resolves.toMatchObject({ status: 'complete' });

  expect(requestReadAuthorizations).toHaveBeenCalledTimes(1);
  expect(requestReadAuthorizations).toHaveBeenCalledWith(['sleep']);
});

test('keeps an unavailable HealthKit request retryable and reports its stage', async () => {
  const repository = new MemoryObservationRepository();
  const requestReadAuthorizations = jest.fn(async () => ({
    availability: 'unavailable' as const,
    requestStatus: 'notRequested' as const,
    readAuthorization: 'notObservable' as const,
    requestedFeatures: [] as const,
    unsupportedFeatures: [] as const,
  }));
  const querySampleChanges = jest.fn();

  await expect(
    configureHealthKitAutoSync(['sleep'], {
      repository,
      healthKit: { requestReadAuthorizations, querySampleChanges },
      now: () => now,
    }),
  ).resolves.toMatchObject({
    status: 'retryable',
    authorizationFailure: {
      stage: 'availability',
      code: 'healthDataUnavailable',
    },
  });

  expect(querySampleChanges).not.toHaveBeenCalled();
  await expect(loadHealthKitAutoSyncStatus(repository)).resolves.toMatchObject({
    status: 'retryable',
  });
});

test('maps a sanitized native presentation failure to retryable recovery details', async () => {
  const repository = new MemoryObservationRepository();
  const failure = Object.assign(new Error('private native detail'), {
    code: 'HEALTHKIT_AUTHORIZATION_PRESENTATION_UNAVAILABLE',
  });
  const requestReadAuthorizations = jest.fn().mockRejectedValue(failure);
  const querySampleChanges = jest.fn();

  await expect(
    configureHealthKitAutoSync(['medications'], {
      repository,
      healthKit: { requestReadAuthorizations, querySampleChanges },
      now: () => now,
    }),
  ).resolves.toMatchObject({
    status: 'retryable',
    authorizationFailure: {
      stage: 'presentation',
      code: 'presentationUnavailable',
    },
  });

  expect(querySampleChanges).not.toHaveBeenCalled();
  expect(
    JSON.stringify(await loadHealthKitAutoSyncStatus(repository)),
  ).not.toContain('private native detail');
});

test('reports standard and per-medication request failures without native details', async () => {
  const failures = [
    {
      nativeCode: 'HEALTHKIT_AUTHORIZATION_STANDARD_REQUEST_FAILED',
      stage: 'standardRequest',
    },
    {
      nativeCode: 'HEALTHKIT_AUTHORIZATION_MEDICATION_REQUEST_FAILED',
      stage: 'medicationRequest',
    },
  ] as const;

  for (const failure of failures) {
    const repository = new MemoryObservationRepository();
    const requestReadAuthorizations = jest.fn().mockRejectedValue(
      Object.assign(new Error('private native detail'), {
        code: failure.nativeCode,
      }),
    );
    const querySampleChanges = jest.fn();

    await expect(
      configureHealthKitAutoSync(['medications'], {
        repository,
        healthKit: { requestReadAuthorizations, querySampleChanges },
        now: () => now,
      }),
    ).resolves.toMatchObject({
      status: 'retryable',
      authorizationFailure: { stage: failure.stage, code: 'requestFailed' },
    });
    expect(querySampleChanges).not.toHaveBeenCalled();
  }
});
