import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { loadHomeMetrics } from './metricLoader';
import { seedHomeOverviewHealth } from '../../../e2e/homeOverviewFixture';

test('projects real local samples with original source names and leaves absent days empty', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const sample = healthObservation(
      'heart',
      'heart_rate',
      '2026-10-14T10:00:00Z',
    );
    await records.put('health_observation', {
      ...sample,
      ingestedAt: '2026-10-15T11:00:00Z',
      provenance: {
        ...sample.provenance,
        source: {
          system: 'healthkit',
          sourceIdentifier: 'watch',
          sourceName: 'My Watch',
        },
      },
    });
    const sleep = healthObservation(
      'sleep',
      'HKCategoryTypeIdentifierSleepAnalysis',
      '2026-10-14T01:00:00Z',
      'healthkit',
      'imported',
      '2026-10-14T02:00:00Z',
    );
    await records.put('health_observation', {
      ...sleep,
      ingestedAt: '2026-10-15T11:00:00Z',
      provenance: {
        ...sleep.provenance,
        source: {
          system: 'healthkit',
          sourceIdentifier: 'watch',
          sourceName: 'My Watch',
        },
      },
    });
    const { metrics } = await loadHomeMetrics(
      database,
      new Date('2026-10-15T12:00:00Z'),
    );
    expect(metrics.heartRate).toMatchObject({
      source: 'My Watch',
      unit: 'count/min',
      measuredAt: sample.effectiveAt,
    });
    expect(metrics.sleep).toMatchObject({
      source: 'My Watch',
      measuredAt: sleep.effectiveAt,
    });
    expect(
      metrics.sleep?.days.find(day => day.value !== null)?.value,
    ).toBeCloseTo(60);
    expect(metrics.heartRate?.days.at(-1)?.value).toBeNull();
  } finally {
    close();
  }
});

test('the existing Home probe seeds local observations consumed by the production loader', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const now = new Date('2026-10-15T12:00:00Z');
    await seedHomeOverviewHealth(createRecordRepository(database), now);
    const { metrics } = await loadHomeMetrics(database, now);
    expect(metrics.heartRate).toMatchObject({
      source: 'Synthetic Watch',
      unit: 'count/min',
    });
    expect(metrics.sleep).toMatchObject({
      source: 'Synthetic Watch',
      unit: 'min',
    });
    expect(metrics.heartRate?.days.some(day => day.value === null)).toBe(true);
    expect(metrics.sleep?.comparison).not.toBeNull();
  } finally {
    close();
  }
});

test('suppresses a sleep comparison when contributing sources differ between windows', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (const [id, date, sourceIdentifier] of [
      ['old', '2026-10-02', 'watch'],
      ['new', '2026-10-10', 'phone'],
    ] as const) {
      const sample = healthObservation(
        id,
        'HKCategoryTypeIdentifierSleepAnalysis',
        `${date}T01:00:00Z`,
        'healthkit',
        'imported',
        `${date}T02:00:00Z`,
      );
      await records.put('health_observation', {
        ...sample,
        ingestedAt: '2026-10-15T11:00:00Z',
        provenance: {
          ...sample.provenance,
          source: {
            system: 'healthkit',
            sourceIdentifier,
            sourceName: sourceIdentifier,
          },
        },
      });
    }
    const { metrics } = await loadHomeMetrics(
      database,
      new Date('2026-10-15T12:00:00Z'),
    );
    expect(metrics.sleep?.comparison).toBeNull();
    expect(metrics.sleep?.source).toContain('watch');
    expect(metrics.sleep?.source).toContain('phone');
  } finally {
    close();
  }
});
