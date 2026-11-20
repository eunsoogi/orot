import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { loadOverviewMetrics, overviewMetricWindow } from './metricLoader';
import { seedOverviewHealth } from '../../../e2e/overviewFixture';

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
    const { metrics } = await loadOverviewMetrics(
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
    await seedOverviewHealth(createRecordRepository(database), now);
    const { metrics } = await loadOverviewMetrics(database, now);
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
    const { metrics } = await loadOverviewMetrics(
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

test('deduplicates quantity source metadata without ranking each sample and keeps source eligibility', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  const now = new Date('2026-10-15T12:00:00Z');
  const previous = overviewMetricWindow(now).fromInclusive;
  const recent = new Date(now.getTime() - 86400000).toISOString();
  const atStart = Date.parse(previous);
  const plans: string[][] = [];
  const observed: SqlDatabase = {
    ...database,
    transaction: operation =>
      database.transaction(tx =>
        operation({
          ...tx,
          async execute(sql, bindings) {
            if (
              sql.includes(
                'PARTITION BY concept, unit, sensor, name, identifier',
              )
            ) {
              const plan = await tx.execute(
                `EXPLAIN QUERY PLAN ${sql}`,
                bindings,
              );
              plans.push(plan.rows.map(row => String(row.detail)));
            }
            return tx.execute(sql, bindings);
          },
        }),
      ),
  };
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (const [id, at, name, unit] of [
      ['previous', previous, 'Original Watch', 'count/min'],
      ['recent', recent, 'Renamed Watch', 'count/min'],
      ['duplicate', recent, 'Renamed Watch', 'count/min'],
      [
        'before',
        new Date(atStart - 1).toISOString(),
        'Before window',
        'count/min',
      ],
      ['exclusive', now.toISOString(), 'After window', 'count/min'],
      ['conflict', recent, 'Incompatible unit', 'count/s'],
      ['stale', recent, 'Superseded Watch', 'count/min'],
    ] as const) {
      const sample = healthObservation(id, 'heart_rate', at);
      await records.put('health_observation', {
        ...sample,
        ingestedAt: now.toISOString(),
        value: { kind: 'quantity', amount: 72, unit },
        provenance: {
          ...sample.provenance,
          source: {
            system: 'healthkit',
            sourceIdentifier: 'synthetic-watch',
            sourceName: name,
          },
        },
      });
    }
    await database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'transcript',
        'health_observation',
        'stale',
        'old',
        'current',
        now.toISOString(),
      ],
    );

    const before = await loadOverviewMetrics(observed, now);
    expect(before.metrics.heartRate).toMatchObject({
      source: 'Original Watch, Renamed Watch',
      measuredAt: recent,
      comparison: null,
    });
    await records.delete('health_observation', 'conflict');
    const after = await loadOverviewMetrics(observed, now);
    expect(after.metrics.heartRate).toMatchObject({
      source: 'Original Watch, Renamed Watch',
      comparison: { previous: 72, recent: 72 },
    });
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan).toContain('USE TEMP B-TREE FOR DISTINCT');
      expect(plan).toContain('USE TEMP B-TREE FOR ORDER BY');
      expect(plan).toContainEqual(
        expect.stringMatching(
          /SEARCH r USING INDEX health_context_\w+ \(<expr>=\? AND <expr>>\? AND <expr><\?\)/,
        ),
      );
    }
  } finally {
    close();
  }
});
