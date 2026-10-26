import { configureHealthKitAutoSync } from '../autoSyncSettings';
import { runHealthKitAutoSync } from '../autoSync';
import { saveHealthKitAutoSyncSelection } from '../autoSyncCheckpoint';
import { MemoryObservationRepository } from '../commonObservations/testSupport';
import { page } from '../sleep/sleepImporterFixtures';
import type { HealthKitSampleChangesResult } from '../types';

/** A selection saved during launch sync must get its own pass over all newly opted-in types. */
test('refreshes a new selection after an older launch query finishes', async () => {
  const repository = new MemoryObservationRepository();
  const now = () => '2026-10-18T12:00:00.000Z';
  await saveHealthKitAutoSyncSelection(repository, ['sleep'], now);
  let release!: (value: HealthKitSampleChangesResult) => void;
  let started!: () => void;
  const queryStarted = new Promise<void>(resolve => {
    started = resolve;
  });
  const querySampleChanges = jest
    .fn()
    .mockImplementationOnce(() => {
      started();
      return new Promise(resolve => {
        release = resolve;
      });
    })
    .mockImplementation(async () => page([], 'next-anchor'));
  const requestReadAuthorizations = jest.fn(async () => ({
    availability: 'available' as const,
    requestStatus: 'completed' as const,
    readAuthorization: 'notObservable' as const,
    requestedFeatures: ['heartRate', 'sleep'] as const,
    unsupportedFeatures: [],
  }));
  const options = {
    repository,
    now,
    healthKit: { querySampleChanges, requestReadAuthorizations },
  };
  const launch = runHealthKitAutoSync(options);
  await queryStarted;
  const configured = configureHealthKitAutoSync(
    ['heartRate', 'sleep'],
    options,
  );
  // Let preference/authorization microtasks reach the in-flight run before releasing native I/O.
  await new Promise<void>(resolve => setImmediate(resolve));
  release(page([], 'first-anchor'));
  await launch;
  expect(await configured).toEqual({
    status: 'complete',
    attemptedFeatures: ['heartRate', 'sleep'],
  });
  expect(
    querySampleChanges.mock.calls.map(([request]) => request.feature),
  ).toContain('heartRate');
});
