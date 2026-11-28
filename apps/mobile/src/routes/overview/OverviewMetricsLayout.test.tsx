import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';
import type { OverviewMetric } from './metricSelection';
import type { OverviewMetricProjection } from './metricProjection';
import {
  createComparedMetric,
  createMetric,
} from './overviewMetricLayoutFixtures';

jest.mock('./useOverviewMetrics');
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
}));
const mocked = jest.mocked(useOverviewMetrics);

const allOverviewMetrics: readonly OverviewMetric[] = [
  'sleep',
  'heartRate',
  'bodyMass',
  'steps',
];

function readyOverviewMetrics(selection: readonly OverviewMetric[]) {
  const metrics: Partial<Record<OverviewMetric, OverviewMetricProjection>> = {};
  selection.forEach(metric => {
    const projection = createMetric(metric);
    const from = Date.parse('2026-10-13T23:00:00Z');
    const to = Date.parse('2026-10-14T01:00:00Z');
    metrics[metric] =
      metric === 'sleep'
        ? {
            ...projection,
            sleepEpisode: {
              from,
              to,
              asleepMinutes: 120,
              intervals: [{ stage: 'core', start: from, end: to }],
            },
          }
        : projection;
  });
  return {
    selection,
    metrics,
    quantityTruncated: false,
    state: 'ready' as const,
    retry: jest.fn(),
    save: jest.fn(),
  };
}

function metricGrid() {
  return screen.getByTestId('overview-metric-grid');
}

function cardWidth(metric: OverviewMetric) {
  return StyleSheet.flatten(
    screen.getByTestId(
      metric === 'heartRate'
        ? 'overview-heart-panel'
        : `overview-metric-${metric}`,
    ).props.style,
  )?.width;
}

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const testViewport = {
  ...originalWindow,
  width: 390,
  height: 800,
  fontScale: 1,
};

beforeEach(() =>
  Dimensions.set({ window: testViewport, screen: testViewport }),
);

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
  jest.restoreAllMocks();
});

test.each([2, 3, 4])(
  'fills the measured Home metric width equally for %i selected cards',
  async count => {
    const selection = allOverviewMetrics.slice(0, count);
    mocked.mockReturnValue(readyOverviewMetrics(selection));
    await render(<OverviewMetrics />);

    expect(metricGrid().props.onLayout).toEqual(expect.any(Function));
    await fireEvent(metricGrid(), 'layout', {
      nativeEvent: { layout: { width: 348, height: 600, x: 0, y: 0 } },
    });

    // An ordinary iPhone's measured content must keep each metric on its own row.
    expect(selection.map(cardWidth)).toEqual(Array(count).fill(348));
    for (const metric of selection) {
      if (metric === 'heartRate') {
        expect(
          screen.queryByTestId('overview-metric-chart-heartRate'),
        ).toBeNull();
        continue;
      }
      if (metric === 'sleep') {
        const timeline = within(
          screen.getByTestId('overview-sleep-stage-timeline'),
        );
        expect(
          timeline.getByTestId('overview-sleep-interval-core').props
            .accessibilityLabel,
        ).toMatch(/코어.*부터.*까지/u);
        expect(screen.queryByTestId('overview-metric-chart-sleep')).toBeNull();
        continue;
      }
      const chart = within(
        screen.getByTestId(`overview-metric-chart-${metric}`),
      );
      const selectedPointID = `overview-metric-chart-${metric}-selected-point`;
      expect(chart.queryByTestId(selectedPointID)).toBeNull();
      expect(
        chart.queryByTestId(`overview-metric-chart-${metric}-details`),
      ).toBeNull();
      const plot = chart.getByTestId(`overview-metric-chart-${metric}-plot`);
      expect(plot.props.accessibilityLabel).toContain('2026-10-14');
      expect(plot.props.accessibilityLabel).toContain('2026-10-13');
      expect(plot.props.accessibilityLabel).toContain('출처: 건강 기록');
    }
  },
);

test('reflows measured card widths on resize and large text changes', async () => {
  const dimensions = jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 390, height: 800, scale: 3, fontScale: 1 });
  mocked.mockReturnValue(readyOverviewMetrics(allOverviewMetrics));
  const { rerender } = await render(<OverviewMetrics />);

  await fireEvent(metricGrid(), 'layout', {
    nativeEvent: { layout: { width: 300, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(300);

  await fireEvent(metricGrid(), 'layout', {
    nativeEvent: { layout: { width: 348, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(348);

  await fireEvent(metricGrid(), 'layout', {
    nativeEvent: { layout: { width: 652, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(320);

  dimensions.mockReturnValue({
    width: 390,
    height: 800,
    scale: 3,
    fontScale: 1.25,
  });
  await rerender(<OverviewMetrics />);
  expect(cardWidth('sleep')).toBe(652);

  await fireEvent(metricGrid(), 'layout', {
    nativeEvent: { layout: { width: 600, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(600);
  await fireEvent(metricGrid(), 'layout', {
    nativeEvent: { layout: { width: 812, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(400);
  await fireEvent(metricGrid(), 'layout', {
    nativeEvent: { layout: { width: 440, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(440);
});

test.each([
  [900, 1],
  [600, 1],
  [599, 1],
  [900, 1.3],
  [321, 1],
  [260, 1],
  [321, 1.25],
] as const)(
  'keeps the compact comparison readable at %ipt measured width and %f font scale',
  async (bodyWidth, fontScale) => {
    jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
      width: 390,
      height: 800,
      scale: 3,
      fontScale,
    });
    mocked.mockReturnValue({
      selection: ['sleep', 'heartRate'],
      metrics: {
        sleep: createComparedMetric('sleep', 3, 4),
        heartRate: createComparedMetric('heartRate', 7, 7),
      },
      quantityTruncated: false,
      state: 'ready',
      retry: jest.fn(),
      save: jest.fn(),
    });

    await render(<OverviewMetrics />);
    await fireEvent(metricGrid(), 'layout', {
      nativeEvent: { layout: { width: bodyWidth, height: 800, x: 0, y: 0 } },
    });

    const content = within(
      screen.getByTestId('overview-recent-changes-content'),
    );
    const comparison = content.getByTestId('overview-recent-change-sleep');
    expect(StyleSheet.flatten(comparison.props.style)?.flexDirection).toBe(
      'row',
    );
    expect(comparison).toHaveTextContent(/30분 늘었어요/u);
    expect(comparison).not.toHaveTextContent(/7시간/u);
    expect(comparison.props.accessible).toBe(true);
    expect(comparison.props.accessibilityLabel).toEqual(
      expect.stringMatching(
        /2026-10-01–2026-10-07.*7시간 0분.*기록된 날: 3일\/7일.*2026-10-08–2026-10-14.*7시간 30분.*기록된 날: 4일\/7일/u,
      ),
    );
    expect(
      content.getByTestId('overview-recent-change-heartRate'),
    ).toBeVisible();
  },
);
