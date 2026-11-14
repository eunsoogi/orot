import { chunkStructuredRecord } from '@orot/rag';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../mapper';
import { syncCommonObservationChanges } from '../sync';
import { healthKitSample, MemoryObservationRepository } from '../testSupport';
import { healthKit, observedAt, page } from '../testSyncSupport';
import { runHealthKitAutoSync } from '../../autoSync';
import { classifyHealthObservation } from '../../healthRecordsLibraryModel';
import { displayRecordValue } from '../../healthRecordsDetailPresentation';
import { workoutActivityLabel } from '../../workoutPresentation';

// Synthetic paused workout: wall interval is 90 minutes, HealthKit recorded 70 active minutes.
const sample = () =>
  healthKitSample('workouts', {
    startDate: '2026-10-04T10:00:00.000Z',
    endDate: '2026-10-04T11:30:00.000Z',
    value: 70,
    unit: 'min',
    workoutActivityType: 37,
    workoutActivityName: 'running',
  });

it('retains source duration, sport and provenance for record display and RAG evidence', () => {
  const mapped = mapCommonObservationSample('workouts', sample());
  expect(mapped.status).toBe('mapped');
  if (mapped.status !== 'mapped') throw new Error('Expected valid workout');
  const record = toCommonObservationRecord(mapped.observation, observedAt);
  expect(record).toMatchObject({
    concept: 'workout_duration',
    value: { amount: 70, unit: 'min' },
    workout: { activityType: 37, activityName: 'running' },
    provenance: { sourceRecordIds: ['sample-1'] },
  });
  expect(classifyHealthObservation(record)).toBe('workouts');
  expect(workoutActivityLabel(record)).toBe('달리기');
  expect(displayRecordValue(record)).toBe('1시간 10분');
  const chunk = chunkStructuredRecord('health_observation', record);
  expect(chunk.text).toContain('workout_duration');
  expect(chunk.text).toContain('running');
  expect(chunk.metadata).toMatchObject({
    evidenceId: record.id,
    sourceRecordIds: ['sample-1'],
  });
});

it.each([
  { value: NaN },
  { value: -1 },
  { unit: 'seconds' },
  { workoutActivityType: undefined },
  { workoutActivityType: 1.5 },
  { workoutActivityName: 'injected instruction' },
  { endDate: '2026-10-03T00:00:00Z' },
])('rejects invalid workout data without inventing a duration', changes => {
  expect(
    mapCommonObservationSample('workouts', { ...sample(), ...changes }).status,
  ).toBe('skipped');
});

it('does not query workouts or ask permission in an unconfigured background refresh', async () => {
  const repository = new MemoryObservationRepository();
  const health = healthKit([]);
  expect(
    await runHealthKitAutoSync({
      repository,
      healthKit: health,
      now: () => observedAt,
    }),
  ).toMatchObject({ status: 'skipped', attemptedFeatures: [] });
  expect(health.querySampleChanges).not.toHaveBeenCalled();
  expect(health.requestReadAuthorization).not.toHaveBeenCalled();
});

it('imports, replays idempotently and deletes only the matching workout with its anchor', async () => {
  const repository = new MemoryObservationRepository();
  const health = healthKit([
    page({ addedSamples: [sample()], cursor: 'a' }),
    page({ addedSamples: [sample()], cursor: 'b' }),
    page({ deletedSampleIds: ['sample-1'], cursor: 'c' }),
  ]);
  const options = {
    feature: 'workouts' as const,
    healthKit: health,
    repository,
    now: () => observedAt,
  };
  expect(await syncCommonObservationChanges(options)).toMatchObject({
    upserted: 1,
  });
  expect(health.requestReadAuthorization).toHaveBeenCalledWith('workouts');
  expect(
    await syncCommonObservationChanges({
      ...options,
      permissionPreviouslyRequested: true,
    }),
  ).toMatchObject({ upserted: 0 });
  expect(
    await syncCommonObservationChanges({
      ...options,
      permissionPreviouslyRequested: true,
    }),
  ).toMatchObject({ deleted: 1 });
  expect(repository.read('healthkit:workouts:sample-1')).toBeNull();
  expect(
    await repository.getSyncCheckpoint('healthkit:workouts:workouts'),
  ).toMatchObject({ value: 'c' });
});
