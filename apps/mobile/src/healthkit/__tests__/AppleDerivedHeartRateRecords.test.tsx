import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ChartData } from '../../ui/charts';
import type { HealthObservationPageLoader } from '@orot/storage';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { readHealthObservationPage } from '../../../../../packages/storage/src/healthObservationPages';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../commonObservations/mapper';
import { healthKitSample } from '../commonObservations/testSupport';
import type { CommonObservationFeature } from '../commonObservations/types';

jest.mock('../../ui/charts', () => {
  const { Text } = require('react-native');
  return {
    ChartPlot: ({ data, testID }: { data: ChartData; testID: string }) => (
      <Text testID={testID}>{JSON.stringify(data)}</Text>
    ),
  };
});

function chartData(category: string): ChartData {
  return JSON.parse(
    screen.getByTestId('health-record-chart-values-' + category).props.children,
  ) as ChartData;
}

function imported(
  feature: CommonObservationFeature,
  id: string,
  value: number,
  at: string,
  sourceName = 'Synthetic Watch',
) {
  const sample = mapCommonObservationSample(
    feature,
    healthKitSample(feature, {
      id,
      value,
      startDate: at,
      endDate: at,
      sourceName,
      sourceIdentifier: 'com.example.' + sourceName.split(' ').pop(),
    }),
  );
  if (sample.status !== 'mapped') throw new Error('Invalid fixture');
  return toCommonObservationRecord(sample.observation, at);
}

test('scopes sparse Apple metrics to owned indexed pages and excludes them only from Other', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const at = '2035-01-15T10:00:00Z';
    const raw = imported('heartRate', 'same', 71, at);
    const resting = imported('restingHeartRate', 'same', 55, at);
    const walking = imported('walkingHeartRateAverage', 'same', 99, at);
    const earlier = imported(
      'restingHeartRate',
      'earlier',
      53,
      '2035-01-01T00:00:00Z',
    );
    const later = imported(
      'restingHeartRate',
      'later',
      57,
      '2035-02-01T00:00:00Z',
    );
    const legacy = {
      ...resting,
      id: 'manual',
      recordedAt: at,
      provenance: { ...resting.provenance, origin: 'user_reported' as const },
    };
    const unverified = {
      ...resting,
      id: 'healthkit:restingHeartRate:unverified',
      recordedAt: at,
      provenance: {
        origin: 'imported' as const,
        sourceRecordIds: ['unverified'],
      },
    };
    const wrongUnit = {
      ...walking,
      id: 'healthkit:walkingHeartRateAverage:bad-unit',
      provenance: { ...walking.provenance, sourceRecordIds: ['bad-unit'] },
      value: { kind: 'quantity' as const, amount: 88, unit: 'count' },
    };
    const unrelatedAnchor = {
      ...resting,
      id: 'healthkit:restingHeartRate:not-the-sample',
    };
    for (const record of [
      raw,
      resting,
      walking,
      earlier,
      later,
      legacy,
      unverified,
      wrongUnit,
      unrelatedAnchor,
    ]) {
      await repository.put('health_observation', record);
    }
    const fromInclusive = '2035-01-10T00:00:00Z';
    const toInclusive = at;
    const read = (
      category:
        | 'heart_rate'
        | 'resting_heart_rate'
        | 'walking_heart_rate_average'
        | 'other',
    ) =>
      repository.listHealthObservationPage(null, 1, {
        category,
        fromInclusive,
        toInclusive,
      });
    expect((await read('heart_rate')).records.map(r => r.id)).toEqual([raw.id]);
    expect(await read('resting_heart_rate')).toEqual({
      records: [resting],
      nextCursor: null,
    });
    expect(
      (await read('walking_heart_rate_average')).records.map(r => r.id),
    ).toEqual([walking.id]);
    const other = await repository.listHealthObservationPage(null, 10, {
      category: 'other',
      fromInclusive,
      toInclusive,
    });
    expect(other.records.map(record => record.id).sort()).toEqual(
      [legacy.id, unverified.id, wrongUnit.id, unrelatedAnchor.id].sort(),
    );

    let queryPlan = '';
    await readHealthObservationPage(
      {
        execute: async (sql, values) => {
          const plan = await database.execute(
            'EXPLAIN QUERY PLAN ' + sql,
            values,
          );
          queryPlan = plan.rows.map(row => row.detail).join(' ');
          return database.execute(sql, values);
        },
      },
      null,
      1,
      { category: 'resting_heart_rate', fromInclusive, toInclusive },
    );
    expect(queryPlan).toContain(
      'SEARCH health_observations USING INDEX health_observations_local_query_idx',
    );

    await repository.delete('health_observation', resting.id);
    expect(await read('resting_heart_rate')).toEqual({
      records: [],
      nextCursor: null,
    });
    expect((await read('walking_heart_rate_average')).records).toHaveLength(1);
  } finally {
    close();
  }
});

test('plots exact Apple metrics separately with source and partial-data coverage', async () => {
  const at = new Date(Date.now() - 60_000).toISOString();
  const raw = healthObservation('raw', 'heart_rate', at);
  const first = imported('restingHeartRate', 'r1', 60, at);
  const second = imported('restingHeartRate', 'r2', 82, at, 'Synthetic Phone');
  const walking = imported('walkingHeartRateAverage', 'w1', 99, at);
  let walkingImported = false;
  const loader: HealthObservationPageLoader = async (_cursor, filter) => {
    if (filter?.category === 'resting_heart_rate') {
      return {
        records: [first, second, raw],
        nextCursor: { id: second.id, effectiveAt: at },
      };
    }
    const records =
      walkingImported && filter?.category === 'walking_heart_rate_average'
        ? [walking]
        : [raw];
    return { records, nextCursor: null };
  };
  const open = jest.fn();
  const props = {
    loadObservations: loader,
    onBack: jest.fn(),
    onOpenHealthImport: jest.fn(),
    onOpenDetail: open,
  };
  const result = await render(<HealthRecordsLibraryScreen {...props} />);
  await fireEvent.press(screen.getByRole('button', { name: '안정 시 심박수' }));
  const { coverage, series } = chartData('resting_heart_rate');
  expect(coverage.status).toBe('partial');
  const points = series.flatMap(item => item.points);
  expect(
    points.map(point => [point.value, point.source, point.partial]),
  ).toEqual([
    [82, '건강 앱 · Synthetic Phone', true],
    [60, '건강 앱 · Synthetic Watch', true],
  ]);
  expect(points.map(point => point.range?.samples)).toEqual([1, 1]);
  expect(screen.queryByText(/개의 평균:/)).toBeNull();
  await fireEvent.press(
    screen.getByTestId('health-record-open-detail-resting_heart_rate'),
  );
  expect(open).toHaveBeenCalledWith({
    category: 'resting_heart_rate',
    period: 'month',
  });
  await fireEvent.press(
    screen.getByRole('button', { name: '걷기 평균 심박수' }),
  );
  expect(
    screen.getByTestId(
      'health-record-category-empty-walking_heart_rate_average',
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/개의 평균:/)).toBeNull();

  walkingImported = true;
  await result.rerender(
    <HealthRecordsLibraryScreen {...props} refreshRevision={1} />,
  );
  await screen.findByTestId(
    'health-record-chart-values-walking_heart_rate_average',
  );
  expect(chartData('walking_heart_rate_average').series[0]?.points).toEqual([
    expect.objectContaining({
      value: 99,
      range: { minimum: 99, maximum: 99, samples: 1 },
    }),
  ]);
  expect(
    screen.queryByTestId('health-record-chart-values-resting_heart_rate'),
  ).toBeNull();
});
