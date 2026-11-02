import { MemoryObservationRepository } from '../../healthkit/commonObservations/testSupport';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import {
  loadHomeMetricSelection,
  saveHomeMetricSelection,
} from './metricSelection';

test('persists ordered choices and rejects invalid selections without changing them', async () => {
  const repository = new MemoryObservationRepository();
  await expect(loadHomeMetricSelection(repository)).resolves.toEqual([
    'sleep',
    'heartRate',
  ]);
  await saveHomeMetricSelection(repository, ['steps', 'sleep', 'bodyMass']);
  await expect(loadHomeMetricSelection(repository)).resolves.toEqual([
    'steps',
    'sleep',
    'bodyMass',
  ]);
  await expect(
    saveHomeMetricSelection(repository, ['sleep', 'sleep']),
  ).rejects.toThrow();
  await expect(loadHomeMetricSelection(repository)).resolves.toEqual([
    'steps',
    'sleep',
    'bodyMass',
  ]);
});

test('propagates save failures', async () => {
  await expect(
    saveHomeMetricSelection(
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
    await saveHomeMetricSelection(createRecordRepository(first.database), [
      'steps',
      'sleep',
    ]);
    first.close();
    const reopened = createHealthEvidenceTestDatabase(path);
    try {
      await runMigrations(reopened.database);
      await expect(
        loadHomeMetricSelection(createRecordRepository(reopened.database)),
      ).resolves.toEqual(['steps', 'sleep']);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
