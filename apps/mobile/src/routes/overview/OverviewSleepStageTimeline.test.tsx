import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { OverviewMetricCard } from './OverviewMetricCard';
import type { OverviewMetricProjection } from './metricProjection';
import {
  projectLatestSleepEpisode,
  sleepStageTransitions,
  type SourcedSleepInterval,
} from './overviewSleepEpisode';
import { loadOverviewMetrics } from './metricLoader';

const from = '2026-11-01T03:00:00Z';
const to = '2026-11-02T02:00:00Z';
const utc = (input: string) => Date.parse(input);
const row = (
  stage: SourcedSleepInterval['stage'],
  start: string,
  end: string,
  source = 'one',
): SourcedSleepInterval => ({
  stage,
  start: utc(start),
  end: utc(end),
  source,
});
const samples = [
  row('core', '2026-11-01T03:30:00Z', '2026-11-01T05:30:00Z'),
  row('awake', '2026-11-01T05:30:00Z', '2026-11-01T05:40:00Z'),
  row('rem', '2026-11-01T06:10:00Z', '2026-11-01T06:30:00Z'),
  row('deep', '2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z'),
];
const metric: OverviewMetricProjection = {
  metric: 'sleep',
  unit: 'min',
  source: 'Synthetic',
  measuredAt: null,
  latest: { date: '2026-11-01', value: 200 },
  timeZone: 'America/New_York',
  comparison: null,
  days: [],
};

test('no source, no asleep interval or invalid timing makes no staged episode', () => {
  expect(projectLatestSleepEpisode([])).toBeUndefined();
  expect(
    projectLatestSleepEpisode([samples[1]!, { ...samples[0]!, source: '' }]),
  ).toBeUndefined();
  expect(
    projectLatestSleepEpisode([{ ...samples[0]!, end: samples[0]!.start }]),
  ).toBeUndefined();
});

test('elapsed total preserves the clock fold, deduplicates overlaps and does not fill real gaps or combine other sources', () => {
  const result = projectLatestSleepEpisode([
    ...samples,
    samples[0]!,
    row(
      'deep',
      '2026-11-01T05:40:00Z',
      '2026-11-01T06:10:00Z',
      'different source',
    ),
  ])!;
  expect(result.asleepMinutes).toBe(200);
  expect(result.intervals.map(x => x.stage)).toEqual([
    'core',
    'awake',
    'rem',
    'deep',
  ]);
  expect(result.intervals[2]!.start - result.intervals[1]!.end).toBe(
    30 * 60_000,
  );
  expect(result.to - result.from).toBe(240 * 60_000);
});

test.each([230, 660] as const)(
  'renders truthful plotted widths and VoiceOver times on card width %i',
  async width => {
    await act(async () => {
      await render(
        <OverviewMetricCard
          width={width}
          metric={{
            ...metric,
            sleepEpisode: projectLatestSleepEpisode(samples),
          }}
        />,
      );
    });
    const awake = screen.getByTestId('overview-sleep-interval-awake');
    const rem = screen.getByTestId('overview-sleep-interval-rem');
    expect(awake.props.accessibilityLabel).toMatch(/GMT-4/);
    expect(rem.props.accessibilityLabel).toMatch(/GMT-5/);
    expect(
      parseFloat(StyleSheet.flatten(rem.props.style).left),
    ).toBeGreaterThan(
      parseFloat(StyleSheet.flatten(awake.props.style).left) +
        parseFloat(StyleSheet.flatten(awake.props.style).width),
    );
    expect(screen.queryByText(/보통|수면 점수/)).toBeNull();
    expect(
      screen.getByTestId('overview-sleep-duration-core'),
    ).toHaveTextContent('2시간 0분');
    expect(
      screen.getAllByTestId('overview-sleep-stage-connector'),
    ).toHaveLength(2);
  },
);

test('unspecified duration without genuine stages stays summary only', async () => {
  const duration = projectLatestSleepEpisode([
    { ...samples[0]!, stage: 'unspecified' },
  ])!;
  expect(duration).toMatchObject({ asleepMinutes: 120, intervals: [] });
  await render(
    <OverviewMetricCard
      width={320}
      metric={{ ...metric, sleepEpisode: duration }}
    />,
  );
  expect(screen.getByText('기록된 수면 단계가 없어요.')).toBeVisible();
  expect(screen.queryByTestId('overview-sleep-stage-timeline')).toBeNull();
});

test('the existing SQLite owner sees actual HealthKit stages but not a second source or unproven import', async () => {
  const fixture = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(fixture.database);
    const records = createRecordRepository(fixture.database);
    for (const [i, x] of [
      ...samples,
      { ...samples[0]!, source: 'two' },
      { ...samples[0]!, source: '' },
    ].entries()) {
      const record = healthObservation(
        'synthetic-' + i,
        'HKCategoryTypeIdentifierSleepAnalysis',
        new Date(x.start).toISOString(),
        'healthkit',
        'imported',
        new Date(x.end).toISOString(),
      );
      await records.put('health_observation', {
        ...record,
        ingestedAt: to,
        value: {
          kind: 'text',
          text: (
            {
              awake: '2',
              core: '3',
              deep: '4',
              rem: '5',
              unspecified: '1',
            } as const
          )[x.stage],
        },
        provenance: {
          ...record.provenance,
          source: {
            system: 'healthkit',
            sourceIdentifier: x.source || undefined,
          },
        },
      });
    }
    const { metrics } = await loadOverviewMetrics(
      fixture.database,
      new Date(to),
      undefined,
      ['sleep'],
    );
    const actual = metrics.sleep?.sleepEpisode;
    expect(actual?.from).toBe(Date.parse(from) + 30 * 60_000);
    expect(actual?.asleepMinutes).toBe(200);
    expect(actual?.intervals.map(x => x.stage)).toEqual([
      'core',
      'awake',
      'rem',
      'deep',
    ]);
  } finally {
    fixture.close();
  }
});

test('does not imply a transition while a third stage is observed', () => {
  const episode = projectLatestSleepEpisode([
    ...samples,
    row('deep', '2026-11-01T04:30:00Z', '2026-11-01T05:45:00Z'),
  ])!;
  expect(sleepStageTransitions(episode)).toEqual([
    { from: 'rem', to: 'deep', at: Date.parse('2026-11-01T06:30:00Z') },
  ]);
});
