import { MemoryObservationRepository } from '../../healthkit/commonObservations/testSupport';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import {
  overviewMetricChoices,
  snapshotOverviewMetricSelection,
  validateOverviewMetricSelection,
  loadOverviewMetricSelection,
  saveOverviewMetricSelection,
} from './metricSelection';

test('persists ordered choices and rejects invalid selections without changing them', async () => {
  const repository = new MemoryObservationRepository();
  await expect(loadOverviewMetricSelection(repository)).resolves.toEqual([
    'sleep',
    'heartRate',
  ]);
  await saveOverviewMetricSelection(repository, ['steps', 'sleep', 'bodyMass']);
  await expect(loadOverviewMetricSelection(repository)).resolves.toEqual([
    'steps',
    'sleep',
    'bodyMass',
  ]);
  await expect(
    saveOverviewMetricSelection(repository, ['sleep']),
  ).rejects.toThrow();
  const allMetrics = [
    'workouts',
    'steps',
    'sleep',
    'bodyMass',
    'heartRate',
  ] as const;
  await saveOverviewMetricSelection(repository, allMetrics);
  await expect(loadOverviewMetricSelection(repository)).resolves.toEqual(
    allMetrics,
  );
  await expect(
    saveOverviewMetricSelection(repository, ['sleep', 'sleep']),
  ).rejects.toThrow();
  await expect(loadOverviewMetricSelection(repository)).resolves.toEqual(
    allMetrics,
  );
});

test('propagates save failures', async () => {
  await expect(
    saveOverviewMetricSelection(
      {
        transaction: async () => {
          throw new Error('storage');
        },
      },
      ['sleep', 'steps'],
    ),
  ).rejects.toThrow('storage');
});

test('restores ordered choices after closing and reopening SQLite', async () => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'orot-home-selection-'));
  const path = join(directory, 'records.sqlite');
  try {
    const first = createHealthEvidenceTestDatabase(path);
    await runMigrations(first.database);
    await saveOverviewMetricSelection(
      createRecordRepository(first.database),
      overviewMetricChoices,
    );
    first.close();
    const reopened = createHealthEvidenceTestDatabase(path);
    try {
      await runMigrations(reopened.database);
      await expect(
        loadOverviewMetricSelection(createRecordRepository(reopened.database)),
      ).resolves.toEqual(overviewMetricChoices);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coalesces legacy heart picks at the earliest slot without changing non-heart order', () => {
  expect(
    validateOverviewMetricSelection([
      'steps',
      'walkingHeartRate',
      'sleep',
      'workoutHeartRate',
      'heartRate',
    ]),
  ).toEqual(['steps', 'heartRate', 'sleep']);
  expect(
    validateOverviewMetricSelection(['walkingHeartRate', 'restingHeartRate']),
  ).toEqual(['heartRate']);
  expect(validateOverviewMetricSelection(['heartRate'])).toEqual(['heartRate']);
  expect(
    snapshotOverviewMetricSelection(['steps', 'heartRate', 'sleep']),
  ).toEqual([
    'steps',
    'heartRate',
    'restingHeartRate',
    'walkingHeartRate',
    'sleep',
  ]);
  expect(snapshotOverviewMetricSelection(['steps', 'sleep'])).toEqual([
    'steps',
    'sleep',
  ]);
});
