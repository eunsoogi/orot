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
    metrics[metric] = createMetric(metric);
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
    screen.getByTestId(`overview-metric-${metric}`).props.style,
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
    nativeEvent: { layout: { width: 648, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(320);

  dimensions.mockReturnValue({
    width: 390,
    height: 800,
    scale: 3,
    fontScale: 1.25,
  });
  await rerender(<OverviewMetrics />);
  expect(cardWidth('sleep')).toBe(648);

  await fireEvent(metricGrid(), 'layout', {
    nativeEvent: { layout: { width: 600, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(600);
  await fireEvent(metricGrid(), 'layout', {
    nativeEvent: { layout: { width: 808, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(400);
  await fireEvent(metricGrid(), 'layout', {
    nativeEvent: { layout: { width: 440, height: 600, x: 0, y: 0 } },
  });
  expect(cardWidth('sleep')).toBe(440);
});

test.each([
  [500, 1, 'row', 'wide'],
  [321, 1, 'column', 'header'],
  [260, 1, 'column', 'stacked'],
  [321, 1.25, 'column', 'stacked'],
] as const)(
  'uses responsive layout at %ipt body width and %f font scale (%s expected)',
  async (bodyWidth, fontScale, direction, mode) => {
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

    const comparison = screen.getByTestId('overview-recent-change-sleep');
    expect(StyleSheet.flatten(comparison.props.style)?.flexDirection).toBe(
      direction,
    );
    expect(comparison).toHaveTextContent(/420분/u);
    expect(comparison).toHaveTextContent(/450분/u);
    expect(comparison.props.accessibilityLabel).toContain('기록된 날: 3일/7일');
    expect(comparison.props.accessibilityLabel).toContain('기록된 날: 4일/7일');
    const identity = StyleSheet.flatten(
      screen.getByTestId('overview-recent-change-identity-sleep').props.style,
    );
    expect(identity.maxWidth).toBe(mode === 'wide' ? 140 : '100%');
    expect(
      Boolean(screen.queryByTestId('overview-recent-change-periods-sleep')),
    ).toBe(mode !== 'stacked');
    if (mode !== 'stacked') {
      expect(screen.getAllByText('이전 7일')).toHaveLength(2);
      expect(screen.getByText('· 3일 기록')).toBeTruthy();
      expect(screen.getAllByText('최근 7일')).toHaveLength(2);
      expect(screen.getByText('· 4일 기록')).toBeTruthy();
      expect(screen.getAllByText('→')).toHaveLength(2);
    } else {
      expect(comparison).toHaveTextContent(/2026-10-01–2026-10-07/u);
      expect(comparison).toHaveTextContent(/2026-10-08–2026-10-14/u);
    }
  },
);
