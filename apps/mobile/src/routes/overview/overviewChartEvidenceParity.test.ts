import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import * as reports from '../../healthEvidence/healthContext/healthContextReport';
import { loadOverviewMetrics, overviewMetricWindow } from './metricLoader';

test('Overview charts skip the AI workout-overlap enrichment with identical public projections', async () => {
  const fixture = openOpSqliteFileQueue();
  const now = new Date('2026-01-15T12:00:00.000Z');
  const baselineQueries: string[] = [];
  const chartQueries: string[] = [];
  const tracing = (queries: string[]): SqlDatabase => ({
    ...fixture.database,
    transaction: work =>
      fixture.database.transaction(tx =>
        work({
          ...tx,
          execute(query, args) {
            if (query.includes('latest_workout_end'))
              queries.push('heart-workout-enrichment');
            return tx.execute(query, args);
          },
        }),
      ),
  });
  try {
    await runMigrations(fixture.database);
    const repo = createRecordRepository(fixture.database);
    await repo.put(
      'health_observation',
      healthObservation(
        'heart',
        'heart_rate',
        '2026-01-14T13:00:00Z',
        'healthkit',
        'imported',
        '2026-01-14T13:00:00Z',
      ),
    );
    await repo.put('health_observation', {
      ...healthObservation(
        'workout',
        'workout_duration',
        '2026-01-14T12:00:00Z',
        'healthkit',
        'imported',
        '2026-01-14T14:00:00Z',
      ),
      value: { kind: 'quantity', amount: 120, unit: 'min' },
    });
    // Exercise every supported chart, including marker-aware sleep overlap
    // and an extra sample exactly on the half-open first display cutoff.
    await repo.put(
      'health_observation',
      healthObservation('steps', 'step_count', '2026-01-14T17:00:00Z'),
    );
    await repo.put(
      'health_observation',
      healthObservation('mass', 'body_mass', '2026-01-14T15:00:00Z'),
    );
    await repo.put(
      'health_observation',
      healthObservation(
        'sleep',
        'HKCategoryTypeIdentifierSleepAnalysis',
        '2026-01-13T23:30:00Z',
        'healthkit',
        'imported',
        '2026-01-14T07:00:00Z',
      ),
    );
    await repo.put(
      'health_observation',
      healthObservation('at-cutoff', 'heart_rate', now.toISOString()),
    );
    const withOriginalReport = jest
      .spyOn(reports, 'readOverviewChartHealthContext')
      .mockImplementation((tx, window) => {
        return reports.readHealthContextReport(tx, window, [
          'measurements',
          'activity',
          'sleep',
        ]);
      });
    const later = new Date('2026-01-15T12:01:00.000Z');
    const baselines = [
      await loadOverviewMetrics(tracing(baselineQueries), now),
      await loadOverviewMetrics(tracing(baselineQueries), later),
    ];
    withOriginalReport.mockRestore();
    const charts = [
      await loadOverviewMetrics(tracing(chartQueries), now),
      await loadOverviewMetrics(tracing(chartQueries), later),
    ];
    expect(charts).toEqual(baselines);
    for (const chart of charts)
      expect(Object.keys(chart.metrics).sort()).toEqual([
        'bodyMass',
        'heartRate',
        'sleep',
        'steps',
        'workouts',
      ]);
    expect(charts[0]!.metrics.heartRate!.measuredAt).toBe(
      '2026-01-14T13:00:00Z',
    );
    expect(charts[1]!.metrics.heartRate!.measuredAt).toBe(now.toISOString());
    expect(baselineQueries).toEqual([
      'heart-workout-enrichment',
      'heart-workout-enrichment',
    ]);
    expect(chartQueries).toEqual([]);

    const ingestionCutoff = {
      ...overviewMetricWindow(later),
      dataAvailableThrough: '2026-10-03T00:00:00.000Z',
    };
    const timedOutIngestion = healthObservation(
      'late-arrival',
      'body_mass',
      '2026-01-15T11:00:00Z',
    );
    await repo.put('health_observation', {
      ...timedOutIngestion,
      ingestedAt: '2026-10-04T00:00:00.000Z',
    });
    await fixture.database.transaction(async tx => {
      const chartReport = await reports.readOverviewChartHealthContext(
        tx,
        ingestionCutoff,
      );
      const fullReport = await reports.readHealthContextReport(
        tx,
        ingestionCutoff,
        ['measurements', 'activity', 'sleep'],
      );
      expect(chartReport.quantities).toEqual(
        fullReport.quantities.map(series => ({
          ...series,
          days: series.days.map(({ activityContext: _, ...day }) => day),
        })),
      );
      expect(chartReport.sleep).toEqual(fullReport.sleep);
      expect(chartReport.days).toEqual(fullReport.days);
      expect(chartReport.limitations).toEqual(fullReport.limitations);
      expect(
        chartReport.quantities
          .find(s => s.concept === 'body_mass')
          ?.days.flatMap(d => d.lastAt),
      ).toEqual(['2026-01-14T15:00:00Z']);
    });
    const full = await reports.readHealthContextReport(
      fixture.database,
      overviewMetricWindow(now),
      ['measurements'],
    );
    expect(
      full.quantities
        .find(item => item.concept === 'heart_rate')
        ?.days[0]?.activityContext?.map(group => group.context),
    ).toEqual(['workout_overlap']);
  } finally {
    jest.restoreAllMocks();
    await fixture.close();
  }
});
