import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { HomeMetrics } from './HomeMetrics';
import { useHomeMetrics } from './useHomeMetrics';
import type { HomeMetric } from './metricSelection';
import type { HomeMetricProjection } from './metricProjection';

jest.mock('./useHomeMetrics');
const mocked = jest.mocked(useHomeMetrics);

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
  'announces the %s statistic with a Korean unit and no source details',
  async (
    metric: HomeMetric,
    statistic,
    unit,
    measuredValue,
    formattedValue,
    rawUnit,
  ) => {
    const projection: HomeMetricProjection = {
      metric,
      unit,
      source: 'Synthetic Watch App',
      measuredAt: '2026-10-14T10:00:00Z',
      timeZone: 'Asia/Seoul',
      latest: { date: '2026-10-14', value: measuredValue },
      days: [
        {
          date: '2026-10-14',
          value: measuredValue,
          partial: false,
        },
      ],
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
    await render(<HomeMetrics />);
    const summary = screen.getByTestId(`home-metric-${metric}`);
    expect(summary.props.accessibilityLabel).toContain(statistic);
    expect(summary.props.accessibilityLabel).toContain(`${formattedValue}.`);
    if (rawUnit)
      expect(summary.props.accessibilityLabel).not.toContain(rawUnit);
    expect(summary.props.accessibilityLabel).not.toContain(
      'Synthetic Watch App',
    );
    expect(summary.props.accessibilityLabel).not.toContain('Asia/Seoul');
    expect(screen.getByText(formattedValue)).toBeTruthy();
    expect(
      screen.queryByText(/Synthetic Watch App|Asia\/Seoul|count|min/u),
    ).toBeNull();
    expect(projection).toMatchObject({
      unit,
      source: 'Synthetic Watch App',
      timeZone: 'Asia/Seoul',
      latest: { value: measuredValue },
    });
  },
);

test('formats recent comparisons without exposing source or time-zone details', async () => {
  const metric: HomeMetricProjection = {
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
      previousDates: ['2026-10-01'],
      recentDates: ['2026-10-08'],
    },
  };
  mocked.mockReturnValue({
    selection: ['steps', 'sleep'],
    metrics: { steps: metric },
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });

  await render(<HomeMetrics />);

  const summary = screen.getByTestId('home-metric-steps');
  expect(summary.props.accessibilityLabel).not.toContain('Synthetic Watch App');
  expect(summary.props.accessibilityLabel).not.toContain('Asia/Seoul');
  expect(screen.getByText(/기록된 날의 하루 평균/u)).toBeTruthy();
  expect(screen.getByText(/1,000걸음/u)).toBeTruthy();
  expect(screen.getByText(/1,234걸음/u)).toBeTruthy();
  expect(
    screen.queryByText(/Synthetic Watch App|Asia\/Seoul|count/u),
  ).toBeNull();
  expect(metric).toMatchObject({
    unit: 'count',
    source: 'Synthetic Watch App',
    timeZone: 'Asia/Seoul',
    latest: { value: 500 },
    comparison: { previous: 1000.4, recent: 1234.4 },
  });
});

test('keeps an unsupported metric unit unchanged', async () => {
  const projection: HomeMetricProjection = {
    metric: 'steps',
    unit: 'quantity',
    source: 'Synthetic Watch App',
    measuredAt: null,
    timeZone: 'Asia/Seoul',
    latest: { date: '2026-10-14', value: 70.6 },
    days: [],
    comparison: null,
  };
  mocked.mockReturnValue({
    selection: ['steps', 'sleep'],
    metrics: { steps: projection },
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });

  await render(<HomeMetrics />);

  const summary = screen.getByTestId('home-metric-steps');
  expect(summary.props.accessibilityLabel).toContain('70.6 quantity.');
  expect(summary.props.accessibilityLabel).not.toContain('70걸음.');
  expect(projection.latest.value).toBe(70.6);
  expect(projection.unit).toBe('quantity');
});

test('shows accessible gaps and keeps a failed selection save open for retry', async () => {
  const save = jest.fn().mockRejectedValue(new Error('locked'));
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
  await render(<HomeMetrics />);
  expect(screen.getByLabelText(/2026-10-15: 기록이 없어요/)).toBeTruthy();
  expect(screen.getByLabelText(/해당 날짜 측정 평균/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: /체중/ }));
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('선택을 저장하지 못했어요.')).toBeTruthy();
  expect(save).toHaveBeenCalledWith(['sleep', 'heartRate', 'bodyMass']);
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
  await render(<HomeMetrics />);
  expect(screen.getAllByText('최근 14일과 오늘에 기록이 없어요.')).toHaveLength(
    2,
  );
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  const press = fireEvent.press(screen.getByRole('button', { name: '저장' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled(),
  );
  expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: /체중/ })).toBeDisabled();
  await act(async () => finish());
  await press;
  expect(screen.queryByRole('button', { name: '취소' })).toBeNull();
});
