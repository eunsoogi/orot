import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';
import type { OverviewMetric } from './metricSelection';
import type { OverviewMetricProjection } from './metricProjection';

jest.mock('./useOverviewMetrics');
jest.mock('react-native-chart-kit/v2', () => ({
  ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
  LineChart: () => null,
  BarChart: () => null,
}));
const mocked = jest.mocked(useOverviewMetrics);

test.each([
  ['sleep', '해당 날짜 기록 합계', 'min', 70.4, '70분', 'min'],
  [
    'heartRate',
    '해당 날짜 측정 평균',
    'count/min',
    70.25,
    '70.3회/분',
    'count/min',
  ],
  ['bodyMass', '해당 날짜 마지막 측정', 'kg', 70.25, '70.3 kg', null],
  ['steps', '해당 날짜 기록 합계', 'count', 70.6, '71걸음', 'count'],
] as const)(
  'formats the %s metric in Korean and keeps chart units separate from projection provenance',
  async (
    metric: OverviewMetric,
    statistic: string,
    unit: string,
    measuredValue: number,
    formattedValue: string,
    rawUnit: string | null,
  ) => {
    const projection: OverviewMetricProjection = {
      metric,
      unit,
      source: 'Synthetic Watch App',
      measuredAt: '2026-10-14T10:00:00Z',
      timeZone: 'Asia/Seoul',
      latest: { date: '2026-10-14', value: measuredValue },
      days: [{ date: '2026-10-14', value: measuredValue, partial: false }],
      comparison: null,
    };
    mocked.mockReturnValue({
      selection: [metric, metric === 'sleep' ? 'heartRate' : 'sleep'],
      metrics: { [metric]: projection },
      quantityTruncated: false,
      state: 'ready',
      retry: jest.fn(),
      save: jest.fn(),
    });

    await render(<OverviewMetrics />);

    const summary = screen.getByTestId(`overview-metric-summary-${metric}`);
    expect(summary.props.accessibilityLabel).toContain(statistic);
    expect(summary.props.accessibilityLabel).toContain(`${formattedValue}.`);
    if (rawUnit)
      expect(summary.props.accessibilityLabel).not.toContain(rawUnit);
    expect(summary.props.accessibilityLabel).not.toContain(
      'Synthetic Watch App',
    );
    expect(summary.props.accessibilityLabel).not.toContain('Asia/Seoul');
    expect(screen.getByText(formattedValue)).toBeTruthy();
    expect(screen.getByText(`일별 집계 · ${unit}`)).toBeTruthy();
    expect(
      screen.getByTestId(`overview-metric-chart-${metric}-selected-point`).props
        .accessibilityLabel,
    ).toContain('출처: 건강 기록');
    expect(screen.queryByText(/Synthetic Watch App|Asia\/Seoul/u)).toBeNull();
    expect(projection).toMatchObject({
      unit,
      source: 'Synthetic Watch App',
      timeZone: 'Asia/Seoul',
      latest: { value: measuredValue },
    });
  },
);

test('formats recent comparison units without exposing projection provenance', async () => {
  const dates = (first: number) =>
    Array.from(
      { length: 7 },
      (_, offset) => `2026-10-${String(first + offset).padStart(2, '0')}`,
    );
  const projection: OverviewMetricProjection = {
    metric: 'steps',
    unit: 'count',
    source: 'Synthetic Watch App',
    measuredAt: '2026-10-14T10:00:00Z',
    timeZone: 'Asia/Seoul',
    latest: { date: '2026-10-14', value: 500 },
    days: [],
    comparison: {
      previous: 1000.4,
      recent: 1234.4,
      previousCoverage: 7,
      recentCoverage: 6,
      previousDates: dates(1),
      recentDates: dates(8),
    },
  };
  mocked.mockReturnValue({
    selection: ['steps', 'sleep'],
    metrics: { steps: projection },
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });

  await render(<OverviewMetrics />);

  const recentChange = screen.getByTestId('overview-recent-change-steps');
  expect(recentChange).toHaveTextContent(/1,000걸음/u);
  expect(recentChange).toHaveTextContent(/1,234걸음/u);
  expect(recentChange.props.accessibilityLabel).not.toContain(
    'Synthetic Watch App',
  );
  expect(recentChange.props.accessibilityLabel).not.toContain('Asia/Seoul');
  expect(recentChange).not.toHaveTextContent(
    /Synthetic Watch App|Asia\/Seoul|count/u,
  );
  expect(projection).toMatchObject({
    unit: 'count',
    source: 'Synthetic Watch App',
    timeZone: 'Asia/Seoul',
    latest: { value: 500 },
    comparison: { previous: 1000.4, recent: 1234.4 },
  });
});

test('shows accessible gaps and keeps a failed selection save open for retry', async () => {
  const save = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValueOnce(undefined);
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {
      heartRate: {
        metric: 'heartRate',
        unit: 'count/min',
        source: 'Watch',
        measuredAt: '2026-10-14T10:00:00Z',
        timeZone: 'UTC',
        latest: { date: '2026-10-14', value: 70 },
        days: [
          { date: '2026-10-14', value: 70, partial: false },
          { date: '2026-10-15', value: null, partial: true },
        ],
        comparison: null,
      },
    },
    state: 'ready',
    quantityTruncated: false,
    retry: jest.fn(),
    save,
  });
  await render(<OverviewMetrics />);
  const selected = screen.getByTestId(
    'overview-metric-chart-heartRate-selected-point',
  );
  expect(selected.props.accessibilityLabel).toContain('2026-10-15');
  expect(selected.props.accessibilityLabel).toContain('측정되지 않음');
  expect(selected.props.accessibilityLabel).toContain('일부 기록');
  expect(selected.props.accessibilityLabel).toContain('출처: 건강 기록');
  expect(selected.props.accessibilityLabel).not.toContain('2026-10-14');
  expect(screen.getByLabelText(/해당 날짜 측정 평균/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: /체중/ }));
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('선택을 저장하지 못했어요.')).toBeTruthy();
  expect(save).toHaveBeenCalledWith(['sleep', 'heartRate', 'bodyMass']);
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
  expect(save).toHaveBeenCalledTimes(2);
});

test('cancel discards the draft and keeps the saved selection when editing again', async () => {
  const save = jest.fn();
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save,
  });
  await render(<OverviewMetrics />);
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: /체중/ }));
  await fireEvent.press(screen.getByRole('button', { name: '취소' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  expect(
    screen.getByRole('checkbox', { name: /체중/ }).props.accessibilityState
      .checked,
  ).toBe(false);
  expect(
    screen.getByRole('checkbox', { name: /기록된 수면/ }).props
      .accessibilityState.checked,
  ).toBe(true);
});

test('prevents changing or cancelling a draft while its save is pending', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {
    finish = resolve;
  });
  const save = jest.fn(() => pending);
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save,
  });
  await render(<OverviewMetrics />);
  expect(screen.getAllByText('최근 14일과 오늘에 기록이 없어요.')).toHaveLength(
    2,
  );
  expect(screen.getByText('비교할 기록이 충분하지 않아요.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  const press = fireEvent.press(screen.getByRole('button', { name: '저장' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled(),
  );
  expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: /체중/ })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await press;
  expect(screen.queryByRole('button', { name: '취소' })).toBeNull();
});
