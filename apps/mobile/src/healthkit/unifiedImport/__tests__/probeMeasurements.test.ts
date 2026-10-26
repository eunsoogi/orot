import { summarizeUnifiedImportMeasurements } from '../../../../e2e/unifiedImportProbeMeasurements';
import type { UnifiedImportMeasurement } from '../types';

test('summarizes persistence timings by selected provider and shared preparation separately', () => {
  const measurements: UnifiedImportMeasurement[] = [
    {
      provider: 'healthKit',
      phase: 'query',
      transition: 'started',
      offsetMs: 14,
    },
    {
      provider: 'healthKit',
      phase: 'query',
      transition: 'finished',
      offsetMs: 18,
      durationMs: 4,
      outcome: 'completed',
    },
    {
      provider: 'eventKit',
      phase: 'query',
      transition: 'started',
      offsetMs: 22,
    },
    {
      provider: 'eventKit',
      phase: 'query',
      transition: 'finished',
      offsetMs: 25,
      durationMs: 3,
      outcome: 'completed',
    },
    {
      provider: 'localStore',
      sourceProvider: 'healthKit',
      phase: 'persistence',
      transition: 'started',
      offsetMs: 10,
    },
    {
      provider: 'localStore',
      sourceProvider: 'healthKit',
      phase: 'persistence',
      transition: 'finished',
      offsetMs: 14,
      durationMs: 4,
      outcome: 'completed',
    },
    {
      provider: 'localStore',
      sourceProvider: 'eventKit',
      phase: 'persistence',
      transition: 'started',
      offsetMs: 20,
    },
    {
      provider: 'localStore',
      sourceProvider: 'eventKit',
      phase: 'persistence',
      transition: 'finished',
      offsetMs: 27,
      durationMs: 7,
      outcome: 'completed',
    },
    {
      provider: 'localStore',
      phase: 'storagePreparation',
      transition: 'started',
      offsetMs: 2,
    },
    {
      provider: 'localStore',
      phase: 'storagePreparation',
      transition: 'finished',
      offsetMs: 6,
      durationMs: 4,
      outcome: 'completed',
    },
  ];

  const summary = summarizeUnifiedImportMeasurements(measurements);

  expect(summary).toContain('healthKitQueryStartOffsetMs=14');
  expect(summary).toContain('healthKitQueryFinishedOffsetMs=18');
  expect(summary).toContain('healthKitQueryMs=4');
  expect(summary).toContain('eventKitQueryStartOffsetMs=22');
  expect(summary).toContain('eventKitQueryFinishedOffsetMs=25');
  expect(summary).toContain('eventKitQueryMs=3');
  expect(summary).toContain('healthKitPersistenceOperations=1');
  expect(summary).toContain('healthKitPersistenceStartOffsetMs=10');
  expect(summary).toContain('healthKitPersistenceFinishedOffsetMs=14');
  expect(summary).toContain('healthKitPersistenceMs=4');
  expect(summary).toContain('eventKitPersistenceOperations=1');
  expect(summary).toContain('eventKitPersistenceStartOffsetMs=20');
  expect(summary).toContain('eventKitPersistenceFinishedOffsetMs=27');
  expect(summary).toContain('eventKitPersistenceMs=7');
  expect(summary).toContain('localStorePreparationStartOffsetMs=2');
  expect(summary).toContain('localStorePreparationFinishedOffsetMs=6');
  expect(summary).toContain('localStorePreparationMs=4');
});
