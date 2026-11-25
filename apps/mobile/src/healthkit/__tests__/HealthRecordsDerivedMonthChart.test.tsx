import { fireEvent, render } from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { HealthRecordsMonthChartPanel } from '../HealthRecordsMonthChartPanel';
import { healthKitSample } from '../commonObservations/testSupport';
import { healthKit, page } from '../commonObservations/testSyncSupport';
import { syncCommonObservationChanges } from '../commonObservations/sync';
import { rememberHealthKitAutoSyncRequest } from '../autoSyncCheckpoint';
import { runHealthKitAutoSync } from '../autoSync';
import { ChartTooltipHost } from '../../ui/charts/ChartTooltipHost';

test('normal opted-in legacy sync replaces only the observed singleton with a measured Records range', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    const local = (day: number, hour: number) =>
      new Date(2035, 0, day, hour).toISOString();
    const feature = 'restingHeartRate';
    const now = () => local(17, 18);
    const old = healthKitSample(feature, {
      id: 'legacy',
      value: 62.5,
      startDate: local(14, 8),
      endDate: local(14, 9),
    });
    const missingSummary = healthKitSample(feature, {
      id: 'still-scalar',
      value: 76,
      startDate: local(15, 8),
      endDate: local(15, 9),
    });
    await syncCommonObservationChanges({
      feature,
      repository,
      now,
      healthKit: healthKit([
        page({
          cursor: 'upgraded-anchor',
          addedSamples: [old, missingSummary],
        }),
      ]),
    });
    await rememberHealthKitAutoSyncRequest(repository, feature, now);
    const window = { fromInclusive: local(1, 0), toInclusive: local(31, 18) };
    // The native application supplies this exact protected repository method.
    const load = repository.listHealthObservationMonthChart;
    const before = await load('resting_heart_rate', window);
    expect(before.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ min: 62.5, max: 62.5, sampleCount: 1 }),
      ]),
    );
    const next = healthKit([
      page({ cursor: 'upgraded-anchor' }),
      page({ cursor: 'upgraded-anchor' }),
    ]);
    const querySamples = jest.fn(async () => ({
      availability: 'available' as const,
      status: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      samples: [
        {
          ...old,
          heartRateSampleSummary: {
            count: 4,
            minimum: 53,
            maximum: 82,
            mean: 62.5,
          },
        },
        missingSummary,
      ],
    }));
    const options = { repository, now, healthKit: { ...next, querySamples } };
    await expect(runHealthKitAutoSync(options)).resolves.toMatchObject({
      status: 'complete',
    });
    await expect(runHealthKitAutoSync(options)).resolves.toMatchObject({
      status: 'complete',
    });
    expect(querySamples).toHaveBeenCalledTimes(1);
    expect(next.requestReadAuthorization).not.toHaveBeenCalled();
    await expect(load('resting_heart_rate', window)).resolves.toMatchObject({
      rows: expect.arrayContaining([
        expect.objectContaining({
          min: 53,
          max: 82,
          sampleCount: 4,
          mean: 62.5,
        }),
        expect.objectContaining({ min: 76, max: 76, sampleCount: 1, mean: 76 }),
      ]),
    });
    const view = await render(
      <ChartTooltipHost>
        <HealthRecordsMonthChartPanel
          load={load}
          category="resting_heart_rate"
          window={window}
        />
      </ChartTooltipHost>,
    );
    await fireEvent(view.getByTestId('health-record-month-chart'), 'layout', {
      nativeEvent: { layout: { width: 330, height: 200, x: 0, y: 0 } },
    });
    const plot = await view.findByTestId(
      'health-record-chart-values-resting_heart_rate-plot',
    );
    expect(plot.props.accessibilityLabel).toMatch(
      /최저 53 BPM.*최고 82 BPM.*평균 62 BPM/u,
    );
    const svg = { includeHiddenElements: true };
    expect(view.getByTestId('chart-range-span', svg)).toBeOnTheScreen();
    expect(view.getByTestId('chart-range-mean', svg)).toBeOnTheScreen();
    expect(view.getByTestId('chart-range-flat', svg)).toBeOnTheScreen();
    expect(view.getAllByTestId('chart-range-bucket', svg)).toHaveLength(2);
  } finally {
    f.close();
  }
});

test.each([
  ['restingHeartRate', 'resting_heart_rate'],
  ['walkingHeartRateAverage', 'walking_heart_rate_average'],
] as const)(
  'replaces a deleted %s estimate in its Records day',
  async (feature, category) => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(f.database);
      const repository = createRecordRepository(f.database);
      const local = (day: number, hour: number) =>
        new Date(2035, 0, day, hour).toISOString();
      const now = () => local(17, 18);
      const window = { fromInclusive: local(1, 0), toInclusive: local(31, 18) };
      const old = healthKitSample(feature, {
        id: 'earlier-estimate',
        value: 59,
        startDate: local(17, 8),
        endDate: local(17, 9),
      });
      const replacement = healthKitSample(feature, {
        id: 'current-estimate',
        value: 63,
        startDate: local(17, 8),
        endDate: local(17, 10),
      });
      await expect(
        syncCommonObservationChanges({
          feature,
          repository,
          now,
          healthKit: healthKit([
            page({ cursor: 'earlier-anchor', addedSamples: [old] }),
          ]),
        }),
      ).resolves.toMatchObject({ status: 'complete', upserted: 1 });
      await rememberHealthKitAutoSyncRequest(repository, feature, now);
      const load = repository.listHealthObservationMonthChart;
      const before = await load(category, window);
      expect(before.rows).toHaveLength(1);
      expect(before.rows[0]).toMatchObject({
        min: 59,
        max: 59,
        mean: 59,
        sampleCount: 1,
      });

      // The Watch may retire its prior daily estimate and add a new sample ID.
      // Those successive estimates must not be combined into a measured range.
      const native = healthKit([
        page({
          cursor: 'replacement-anchor',
          addedSamples: [replacement],
          deletedSampleIds: [old.id],
        }),
      ]);
      await expect(
        runHealthKitAutoSync({ repository, now, healthKit: native }),
      ).resolves.toEqual({ status: 'complete', attemptedFeatures: [feature] });
      expect(native.querySampleChanges).toHaveBeenCalledTimes(1);
      expect(native.querySampleChanges).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: 'earlier-anchor' }),
      );
      await expect(
        repository.get('health_observation', `healthkit:${feature}:${old.id}`),
      ).resolves.toBeNull();
      await expect(
        repository.get(
          'health_observation',
          `healthkit:${feature}:${replacement.id}`,
        ),
      ).resolves.toMatchObject({
        provenance: { sourceRecordIds: [replacement.id] },
      });

      const after = await load(category, window);
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0]).toMatchObject({
        min: 63,
        max: 63,
        mean: 63,
        sampleCount: 1,
      });
      const view = await render(
        <ChartTooltipHost>
          <HealthRecordsMonthChartPanel
            load={load}
            category={category}
            window={window}
          />
        </ChartTooltipHost>,
      );
      await fireEvent(view.getByTestId('health-record-month-chart'), 'layout', {
        nativeEvent: { layout: { width: 330, height: 200, x: 0, y: 0 } },
      });
      const plot = await view.findByTestId(
        `health-record-chart-values-${category}-plot`,
      );
      expect(plot.props.accessibilityLabel).toMatch(/63 BPM/u);
      const svg = { includeHiddenElements: true };
      expect(view.getAllByTestId('chart-range-bucket', svg)).toHaveLength(1);
      expect(view.getByTestId('chart-range-flat', svg)).toBeOnTheScreen();
      expect(view.queryByTestId('chart-range-span', svg)).toBeNull();
    } finally {
      f.close();
    }
  },
);
